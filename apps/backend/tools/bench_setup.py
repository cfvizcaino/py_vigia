"""Prepara y limpia un benchmark de carga sobre una central real, sin tocar sus datos.

Se ejecuta dentro del contenedor del backend:

  docker compose exec -T backend python - setup 100 < tools/bench_setup.py > bench-secrets.json
  docker compose exec -T backend python - cleanup  < tools/bench_setup.py

``setup`` crea N cámaras simuladas BENCH-001…, una credencial de 1 día para cada una y un
operador temporal; escribe los tokens y la contraseña en stdout (redirigir a un archivo
0600, nunca a la terminal). ``cleanup`` borra todo lo que tenga prefijo BENCH- o el
correo del operador temporal: cámaras (en cascada: credenciales, eventos, observaciones,
detecciones), consultas y rutas del operador, sus sesiones y la auditoría asociada.
"""
from __future__ import annotations

import json
import math
import secrets
import sys

from sqlalchemy import delete, func, or_, select

from vigia_backend.db import SessionLocal
from vigia_backend.device_credentials import issue
from vigia_backend.models import (
    Device,
    DeviceLink,
    Query,
    RouteResult,
    RouteResultDetection,
    SecurityAudit,
    User,
    UserSession,
)
from vigia_backend.users import create_user

PREFIX = "BENCH-"
EMAIL = "benchmark@vigia.invalid"
# Grid of simulated cameras ~300 m apart, south of the pilot cameras.
ORIGIN = (10.9600, -74.8300)
STEP_DEG = 0.0027


def setup(count: int) -> dict:
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Device).where(Device.external_id.like(f"{PREFIX}%"))):
            raise SystemExit("Ya existen cámaras BENCH-: ejecuta cleanup primero")
        side = math.ceil(math.sqrt(count))
        tokens = {}
        for index in range(count):
            camera = f"{PREFIX}{index + 1:03d}"
            row, col = divmod(index, side)
            db.add(Device(external_id=camera, name=f"Benchmark {index + 1}", kind="simulated", status="simulated",
                          lat=ORIGIN[0] + row * STEP_DEG, lng=ORIGIN[1] + col * STEP_DEG, camera_model="simulada"))
            db.flush()
            _, token = issue(db, camera, days=1)
            tokens[camera] = token
        # Road links between cameras up to 2 grid cells apart (both ways, 1.3x the
        # straight distance), so queries exercise the real route search.
        devices = {d.external_id: d for d in db.scalars(select(Device).where(Device.external_id.like(f"{PREFIX}%")))}
        for index_a in range(count):
            for index_b in range(count):
                (ra, ca), (rb, cb) = divmod(index_a, side), divmod(index_b, side)
                cells = math.hypot(ra - rb, ca - cb)
                if index_a == index_b or cells > 2:
                    continue
                db.add(DeviceLink(from_device_id=devices[f"{PREFIX}{index_a + 1:03d}"].id,
                                  to_device_id=devices[f"{PREFIX}{index_b + 1:03d}"].id,
                                  road_distance_m=round(cells * 300 * 1.3, 1), road_source="bench"))
        password = secrets.token_urlsafe(24)
        create_user(db, EMAIL, "Benchmark temporal", "operator", password)
        db.commit()
        return {"tokens": tokens, "email": EMAIL, "password": password, "origin": ORIGIN, "step_deg": STEP_DEG,
                "side": side}


def cleanup() -> dict:
    with SessionLocal() as db:
        user_id = db.scalar(select(User.id).where(User.email == EMAIL))
        removed = {}
        if user_id is not None:
            query_ids = select(Query.id).where(Query.user_id == user_id)
            route_ids = select(RouteResult.id).where(RouteResult.query_id.in_(query_ids))
            removed["route_detections"] = db.execute(
                delete(RouteResultDetection).where(RouteResultDetection.route_result_id.in_(route_ids))).rowcount
            removed["routes"] = db.execute(delete(RouteResult).where(RouteResult.query_id.in_(query_ids))).rowcount
            removed["queries"] = db.execute(delete(Query).where(Query.user_id == user_id)).rowcount
            removed["sessions"] = db.execute(delete(UserSession).where(UserSession.user_id == user_id)).rowcount
        removed["audit"] = db.execute(delete(SecurityAudit).where(or_(
            SecurityAudit.camera_id.like(f"{PREFIX}%"),
            SecurityAudit.user_id == user_id if user_id is not None else False,
        ))).rowcount
        bench_ids = select(Device.id).where(Device.external_id.like(f"{PREFIX}%"))
        removed["links"] = db.execute(delete(DeviceLink).where(or_(
            DeviceLink.from_device_id.in_(bench_ids), DeviceLink.to_device_id.in_(bench_ids)))).rowcount
        # ON DELETE CASCADE in the database removes credentials, ingested events,
        # observations and detections (a Core delete, so the ORM does not null them).
        removed["devices"] = db.execute(delete(Device).where(Device.external_id.like(f"{PREFIX}%"))).rowcount
        if user_id is not None:
            db.execute(delete(User).where(User.id == user_id))
            removed["users"] = 1
        db.commit()
        return removed


if __name__ == "__main__":
    command = sys.argv[1]
    if command == "setup":
        print(json.dumps(setup(int(sys.argv[2]))))
    elif command == "cleanup":
        print(json.dumps(cleanup()))
    else:
        raise SystemExit("Uso: setup N | cleanup")
