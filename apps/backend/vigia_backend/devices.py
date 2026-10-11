"""Registro local de cámaras edge (Tapo, teléfonos u otras), con auditoría.

Complementa a `device_credentials`: primero se registra la cámara y luego se emite
su token. Se ejecuta con acceso administrativo al host o a la base.
"""
from __future__ import annotations

import argparse
import json
import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Device, SecurityAudit

CAMERA_ID = re.compile(r"^[A-Z0-9][A-Z0-9-]{1,63}$")


def register(db: Session, camera_id: str, name: str, lat: float, lng: float, model: str | None, kind: str = "physical") -> Device:
    if not CAMERA_ID.match(camera_id):
        raise ValueError("El identificador debe usar mayúsculas, números y guiones (p. ej. CEL-01)")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("Coordenadas fuera de rango")
    if kind not in {"physical", "simulated"}:
        raise ValueError("El tipo debe ser physical o simulated")
    if db.scalar(select(Device).where(Device.external_id == camera_id)) is not None:
        raise ValueError("Ya existe una cámara con ese identificador")
    # A newly registered camera stays offline until its first accepted event.
    device = Device(external_id=camera_id, name=name.strip(), kind=kind, status="offline", lat=lat, lng=lng, camera_model=model)
    db.add(device)
    db.add(SecurityAudit(action="device.created", camera_id=camera_id, outcome="allowed", detail={"camera": camera_id, "via": "cli"}))
    return device


def relocate(db: Session, camera_id: str, lat: float, lng: float) -> Device:
    device = db.scalar(select(Device).where(Device.external_id == camera_id))
    if device is None:
        raise ValueError("Cámara no registrada")
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise ValueError("Coordenadas fuera de rango")
    device.lat, device.lng = lat, lng
    db.add(SecurityAudit(action="device.updated", camera_id=camera_id, outcome="allowed",
                         detail={"camera": camera_id, "fields": ["lat", "lng"], "via": "cli"}))
    return device


def main() -> None:
    from .db import SessionLocal, init_db

    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("register")
    create.add_argument("--camera", required=True, help="Identificador estable, p. ej. CEL-01")
    create.add_argument("--name", required=True)
    create.add_argument("--lat", type=float, required=True)
    create.add_argument("--lng", type=float, required=True)
    create.add_argument("--model", help="Equipo, p. ej. 'OPPO CPH2599'")
    create.add_argument("--kind", choices=("physical", "simulated"), default="physical")
    move = commands.add_parser("relocate", help="Corrige la ubicación (las rutas viales deben resincronizarse)")
    move.add_argument("--camera", required=True)
    move.add_argument("--lat", type=float, required=True)
    move.add_argument("--lng", type=float, required=True)
    commands.add_parser("list")
    args = parser.parse_args()
    init_db()
    try:
        with SessionLocal() as db:
            if args.command == "list":
                devices = db.scalars(select(Device).order_by(Device.external_id)).all()
                print(json.dumps([{"camera": d.external_id, "name": d.name, "kind": d.kind, "status": d.status,
                                   "lat": d.lat, "lng": d.lng, "model": d.camera_model} for d in devices], ensure_ascii=False, indent=2))
                return
            device = register(db, args.camera, args.name, args.lat, args.lng, args.model, args.kind) if args.command == "register" \
                else relocate(db, args.camera, args.lat, args.lng)
            db.commit()
            print(json.dumps({"camera": device.external_id, "lat": device.lat, "lng": device.lng}))
    except ValueError as exc:
        parser.exit(1, f"No se completó la operación: {exc}\n")


if __name__ == "__main__":
    main()
