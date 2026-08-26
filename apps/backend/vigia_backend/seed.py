"""Seed determinista: 4 cámaras en Barranquilla, trayectorias y ruido.

Uso (desde apps/backend, con el venv activo):
  python -m vigia_backend.seed
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select

from .db import SessionLocal, init_db
from .models import Detection, Device, DeviceLink, User

# Velocidad urbana de referencia para timestamps plausibles (km/h).
URBAN_SPEED_KMH = 28.0


@dataclass(frozen=True)
class CameraSpec:
    external_id: str
    name: str
    kind: str
    status: str
    lat: float
    lng: float
    camera_model: str | None


# Coordenadas fijas cerca del mapa de la consola. CAM-01↔CAM-02 < 500 m vial;
# el resto entre ~500 m y 2 km vial (road_distance_m >= haversine).
CAMERAS: tuple[CameraSpec, ...] = (
    CameraSpec("CAM-01", "Tapo C110", "physical", "online", 11.0131, -74.8172, "Tapo C110"),
    CameraSpec("CAM-02", "Calle 84", "simulated", "simulated", 11.0110, -74.8148, None),
    CameraSpec("CAM-03", "Parque Venezuela", "simulated", "simulated", 11.0050, -74.8069, None),
    CameraSpec("CAM-04", "Calle 72", "simulated", "offline", 11.0015, -74.8040, None),
)

# Distancias por red vial (m). Un poco mayores que la línea recta.
ROAD_LINKS_M: dict[tuple[str, str], float] = {
    ("CAM-01", "CAM-02"): 420.0,   # cercanas
    ("CAM-01", "CAM-03"): 1650.0,  # distantes
    ("CAM-01", "CAM-04"): 1950.0,
    ("CAM-02", "CAM-03"): 1250.0,
    ("CAM-02", "CAM-04"): 1720.0,
    ("CAM-03", "CAM-04"): 620.0,   # distantes (justo sobre 500 m)
}


@dataclass(frozen=True)
class RouteHop:
    camera_id: str
    direction: str
    confidence: float
    track_id: int


@dataclass(frozen=True)
class VehicleRoute:
    """Secuencia coherente del mismo vehículo virtual (tipo + color fijos)."""

    label: str
    vehicle_type: str
    color: str
    start_at: datetime
    hops: tuple[RouteHop, ...]


@dataclass(frozen=True)
class NoiseDetection:
    camera_id: str
    vehicle_type: str
    color: str
    direction: str
    confidence: float
    observed_at: datetime
    track_id: int


def travel_seconds(road_m: float, speed_kmh: float = URBAN_SPEED_KMH) -> float:
    return (road_m / 1000.0) / speed_kmh * 3600.0


def _base_day() -> datetime:
    return datetime(2026, 8, 25, 14, 30, 0, tzinfo=timezone.utc)


def build_vehicle_routes() -> list[VehicleRoute]:
    t0 = _base_day()
    return [
        # Ruta clara entre cámaras cercanas (CAM-01 → CAM-02).
        VehicleRoute(
            label="auto_blanco_cercano",
            vehicle_type="car",
            color="white",
            start_at=t0,
            hops=(
                RouteHop("CAM-01", "izquierda-a-derecha", 0.94, 101),
                RouteHop("CAM-02", "izquierda-a-derecha", 0.91, 101),
            ),
        ),
        # Misma apariencia, ventana distinta: no debe confundirse con la ruta cercana.
        VehicleRoute(
            label="auto_blanco_tarde",
            vehicle_type="car",
            color="white",
            start_at=t0 + timedelta(minutes=40),
            hops=(
                RouteHop("CAM-03", "arriba-a-abajo", 0.88, 201),
                RouteHop("CAM-04", "arriba-a-abajo", 0.85, 201),
            ),
        ),
        # Trayectoria con huecos distantes (CAM-01 → CAM-03 → CAM-04).
        VehicleRoute(
            label="auto_gris_distante",
            vehicle_type="car",
            color="gray",
            start_at=t0 + timedelta(minutes=5),
            hops=(
                RouteHop("CAM-01", "izquierda-a-derecha", 0.90, 301),
                RouteHop("CAM-03", "izquierda-a-derecha", 0.84, 301),
                RouteHop("CAM-04", "arriba-a-abajo", 0.81, 301),
            ),
        ),
        # Motocicleta en 4 cámaras (secuencia larga).
        VehicleRoute(
            label="moto_negra_larga",
            vehicle_type="motorcycle",
            color="black",
            start_at=t0 + timedelta(minutes=12),
            hops=(
                RouteHop("CAM-01", "derecha-a-izquierda", 0.87, 401),
                RouteHop("CAM-02", "derecha-a-izquierda", 0.86, 401),
                RouteHop("CAM-03", "derecha-a-izquierda", 0.83, 401),
                RouteHop("CAM-04", "abajo-a-arriba", 0.80, 401),
            ),
        ),
    ]


def build_noise() -> list[NoiseDetection]:
    """Detecciones sueltas sin secuencia entre cámaras (falsos positivos potenciales)."""
    t0 = _base_day()
    return [
        NoiseDetection("CAM-01", "car", "red", "indeterminada", 0.72, t0 + timedelta(minutes=2), 901),
        NoiseDetection("CAM-02", "motorcycle", "blue", "arriba-a-abajo", 0.68, t0 + timedelta(minutes=3), 902),
        NoiseDetection("CAM-03", "car", "white", "derecha-a-izquierda", 0.70, t0 + timedelta(minutes=8), 903),
        NoiseDetection("CAM-04", "car", "green", "indeterminada", 0.65, t0 + timedelta(minutes=15), 904),
        NoiseDetection("CAM-02", "car", "gray", "abajo-a-arriba", 0.74, t0 + timedelta(minutes=50), 905),
        NoiseDetection("CAM-01", "motorcycle", "black", "izquierda-a-derecha", 0.69, t0 + timedelta(minutes=55), 906),
    ]


def clear_seed_tables(db) -> None:
    # Orden por FKs: detecciones → enlaces → dispositivos → usuarios demo.
    db.execute(delete(Detection))
    db.execute(delete(DeviceLink))
    db.execute(delete(Device))
    db.execute(delete(User).where(User.email == "demo@vigia.local"))


def seed(db) -> dict:
    clear_seed_tables(db)

    user = User(email="demo@vigia.local", display_name="Operador demo", role="operator")
    db.add(user)

    devices: dict[str, Device] = {}
    for spec in CAMERAS:
        device = Device(
            external_id=spec.external_id,
            name=spec.name,
            kind=spec.kind,
            status=spec.status,
            lat=spec.lat,
            lng=spec.lng,
            camera_model=spec.camera_model,
        )
        db.add(device)
        devices[spec.external_id] = device
    db.flush()

    for (a, b), meters in ROAD_LINKS_M.items():
        db.add(DeviceLink(from_device_id=devices[a].id, to_device_id=devices[b].id, road_distance_m=meters))
        db.add(DeviceLink(from_device_id=devices[b].id, to_device_id=devices[a].id, road_distance_m=meters))

    route_detection_count = 0
    for route in build_vehicle_routes():
        observed = route.start_at
        previous_cam: str | None = None
        for hop in route.hops:
            if previous_cam is not None:
                key = (previous_cam, hop.camera_id)
                reverse = (hop.camera_id, previous_cam)
                road_m = ROAD_LINKS_M.get(key) or ROAD_LINKS_M[reverse]
                observed = observed + timedelta(seconds=travel_seconds(road_m))
            db.add(
                Detection(
                    device_id=devices[hop.camera_id].id,
                    track_id=hop.track_id,
                    vehicle_type=route.vehicle_type,
                    color=route.color,
                    direction=hop.direction,
                    confidence=hop.confidence,
                    observed_at=observed,
                    thumbnail_url=None,
                )
            )
            route_detection_count += 1
            previous_cam = hop.camera_id

    for noise in build_noise():
        db.add(
            Detection(
                device_id=devices[noise.camera_id].id,
                track_id=noise.track_id,
                vehicle_type=noise.vehicle_type,
                color=noise.color,
                direction=noise.direction,
                confidence=noise.confidence,
                observed_at=noise.observed_at,
                thumbnail_url=None,
            )
        )

    db.commit()
    return {
        "users": 1,
        "devices": len(devices),
        "device_links": len(ROAD_LINKS_M) * 2,
        "route_detections": route_detection_count,
        "noise_detections": len(build_noise()),
        "detections_total": route_detection_count + len(build_noise()),
    }


def print_sample(db) -> None:
    print("\n=== Muestra: dispositivos ===")
    for device in db.scalars(select(Device).order_by(Device.external_id)).all():
        print(
            f"  {device.external_id} | {device.name} | {device.kind}/{device.status} | "
            f"lat={device.lat} lng={device.lng}"
        )

    print("\n=== Muestra: enlaces viales (una dirección) ===")
    by_id = {d.id: d.external_id for d in db.scalars(select(Device)).all()}
    seen: set[tuple[str, str]] = set()
    for link in db.scalars(select(DeviceLink)).all():
        a, b = by_id[link.from_device_id], by_id[link.to_device_id]
        key = tuple(sorted((a, b)))
        if key in seen:
            continue
        seen.add(key)
        near = "cercanas" if link.road_distance_m < 500 else "distantes"
        print(f"  {a} ↔ {b}: {link.road_distance_m:.0f} m ({near})")

    print("\n=== Muestra: detecciones (orden temporal) ===")
    rows = db.scalars(select(Detection).order_by(Detection.observed_at)).all()
    for det in rows:
        cam = by_id[det.device_id]
        print(
            f"  {det.observed_at.strftime('%H:%M:%S')} | {cam} | "
            f"{det.vehicle_type}/{det.color} | dir={det.direction} | "
            f"conf={det.confidence:.2f} | track={det.track_id}"
        )


def main() -> None:
    init_db()
    db = SessionLocal()
    try:
        summary = seed(db)
        print("Seed OK:", summary)
        print_sample(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
