"""Sincroniza alternativas OSRM dirigidas fuera del camino de las consultas."""
from __future__ import annotations
import argparse
import math
import os

import httpx
from sqlalchemy import select
from .models import Device, DeviceLink, utc_now

def fetch_options(client: httpx.Client, origin: Device, destination: Device) -> list[dict]:
    points = [[origin.lng, origin.lat], [destination.lng, destination.lat]]
    coordinates = ";".join(f"{lng},{lat}" for lng, lat in points)
    response = client.get(f"/route/v1/driving/{coordinates}", params={
        "alternatives": "3", "overview": "full", "geometries": "geojson",
        "steps": "false", "radiuses": "100;100",
    })
    body = response.json()
    if response.status_code in {200, 400} and body.get("code") == "NoRoute":
        return []
    response.raise_for_status()
    if body.get("code") != "Ok" or not body.get("routes"):
        raise ValueError("OSRM no devolvió rutas válidas; se conserva el inventario anterior")
    options = []
    for index, route in enumerate(body["routes"][:3]):
        distance, duration, weight = (route.get(k) for k in ("distance", "duration", "weight"))
        if not all(isinstance(v, (int, float)) and math.isfinite(v) and v > 0 for v in (distance, duration, weight)):
            raise ValueError("Métricas OSRM inválidas")
        geometry = route.get("geometry", {}).get("coordinates")
        if not isinstance(geometry, list) or not 2 <= len(geometry) <= 50000:
            raise ValueError("Geometría OSRM inválida")
        for p in geometry:
            if not isinstance(p, list) or len(p) != 2 or not all(isinstance(v, (int, float)) and math.isfinite(v) for v in p) or abs(p[0]) > 180 or abs(p[1]) > 90:
                raise ValueError("Coordenada OSRM inválida")
        options.append({"distance_m": distance, "duration_s": duration, "weight": weight,
                        "geometry": geometry, "option_index": index, "source": "osrm",
                        "endpoints": points, "weight_name": route.get("weight_name")})
    return options

def sync_links(db, client, devices):
    if not 2 <= len(devices) <= 25:
        raise ValueError("Sincroniza entre 2 y 25 cámaras por lote explícito")
    # Stage all network results first; any failure leaves the database unchanged.
    staged = [(a, b, fetch_options(client, a, b)) for a in devices for b in devices if a.id != b.id]
    for a, b, options in staged:
        link = db.scalar(select(DeviceLink).where(DeviceLink.from_device_id == a.id, DeviceLink.to_device_id == b.id))
        if link is None:
            link = DeviceLink(from_device_id=a.id, to_device_id=b.id, road_distance_m=0)
            db.add(link)
        link.road_distance_m = options[0]["distance_m"] if options else 0
        link.road_options = options
        link.road_source = "osrm"
        link.road_updated_at = utc_now()
    db.commit()
    return {"directed_pairs": len(staged), "alternatives": sum(len(options) for _, _, options in staged)}

def main():
    from .db import SessionLocal, init_db
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", action="append", required=True, help="Repetir por cada cámara del lote")
    parser.add_argument("--url", default=os.getenv("ROAD_ROUTER_URL", "http://127.0.0.1:5000"))
    args = parser.parse_args()
    init_db()
    try:
        with SessionLocal() as db, httpx.Client(base_url=args.url, timeout=15, trust_env=False) as client:
            devices = list(db.scalars(select(Device).where(Device.external_id.in_(args.camera)).order_by(Device.external_id)))
            if len(devices) != len(set(args.camera)):
                raise ValueError("Hay cámaras no registradas")
            print(sync_links(db, client, devices))
    except (ValueError, httpx.HTTPError) as exc:
        parser.exit(1, f"No se sincronizó: {exc}\n")

if __name__ == "__main__":
    main()
