"""Orquesta consulta: dispositivos cercanos → detecciones → algoritmo de rutas."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .geo import haversine_m
from .models import (
    Detection,
    Device,
    DeviceLink,
    Query,
    RouteResult,
    RouteResultDetection,
    User,
)
from .routing import DetectionPoint, RouteCandidate, reconstruct_routes


@dataclass(frozen=True)
class NearbyDevice:
    device: Device
    distance_m: float


@dataclass(frozen=True)
class QueryExecution:
    query: Query
    nearby_devices: list[NearbyDevice]
    candidate_detections: list[Detection]
    routes: list[RouteCandidate]
    persisted_route_ids: list[uuid.UUID]


def get_or_create_demo_user(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == "demo@vigia.local"))
    if user is not None:
        return user
    user = User(email="demo@vigia.local", display_name="Operador demo", role="operator")
    db.add(user)
    db.flush()
    return user


def find_nearby_devices(db: Session, lat: float, lng: float, radius_m: float) -> list[NearbyDevice]:
    nearby: list[NearbyDevice] = []
    for device in db.scalars(select(Device)).all():
        distance = haversine_m(lat, lng, device.lat, device.lng)
        if distance <= radius_m:
            nearby.append(NearbyDevice(device=device, distance_m=distance))
    nearby.sort(key=lambda item: item.distance_m)
    return nearby


def load_road_links_m(db: Session, device_ids: set[uuid.UUID]) -> dict[tuple[str, str], float]:
    """Mapa (external_id_a, external_id_b) → metros; solo entre dispositivos candidatos."""
    if not device_ids:
        return {}
    devices = {
        d.id: d.external_id
        for d in db.scalars(select(Device).where(Device.id.in_(device_ids))).all()
    }
    links: dict[tuple[str, str], float] = {}
    for link in db.scalars(
        select(DeviceLink).where(
            DeviceLink.from_device_id.in_(device_ids),
            DeviceLink.to_device_id.in_(device_ids),
        )
    ).all():
        a = devices.get(link.from_device_id)
        b = devices.get(link.to_device_id)
        if a and b:
            links[(a, b)] = link.road_distance_m
    return links


def fetch_candidate_detections(
    db: Session,
    device_ids: list[uuid.UUID],
    time_from: datetime,
    time_to: datetime,
    vehicle_type: str | None,
    color: str | None,
) -> list[Detection]:
    if not device_ids:
        return []
    statement = (
        select(Detection)
        .where(Detection.device_id.in_(device_ids))
        .where(Detection.observed_at >= time_from)
        .where(Detection.observed_at <= time_to)
        .order_by(Detection.observed_at)
    )
    if vehicle_type is not None:
        statement = statement.where(Detection.vehicle_type == vehicle_type)
    if color is not None:
        statement = statement.where(Detection.color == color)
    return list(db.scalars(statement).all())


def detections_to_points(
    detections: list[Detection],
    device_by_id: dict[uuid.UUID, Device],
) -> list[DetectionPoint]:
    points: list[DetectionPoint] = []
    for det in detections:
        device = device_by_id.get(det.device_id)
        if device is None:
            continue
        points.append(
            DetectionPoint(
                id=str(det.id),
                camera_id=device.external_id,
                vehicle_type=det.vehicle_type,
                color=det.color,
                direction=det.direction,
                confidence=det.confidence,
                observed_at=det.observed_at,
            )
        )
    return points


def persist_route_results(
    db: Session,
    query: Query,
    routes: list[RouteCandidate],
) -> list[uuid.UUID]:
    ids: list[uuid.UUID] = []
    for route in routes:
        row = RouteResult(
            query_id=query.id,
            rank=route.rank,
            confidence=route.confidence,
            has_distant_gaps=route.has_distant_gaps,
            summary={
                "camera_ids": list(route.camera_ids),
                "vehicle_type": route.vehicle_type,
                "color": route.color,
                "detection_ids": list(route.detection_ids),
            },
        )
        db.add(row)
        db.flush()
        for order, detection_id in enumerate(route.detection_ids):
            db.add(
                RouteResultDetection(
                    route_result_id=row.id,
                    detection_id=uuid.UUID(detection_id),
                    sequence_order=order,
                )
            )
        ids.append(row.id)
    return ids


def execute_query(
    db: Session,
    *,
    lat: float,
    lng: float,
    radius_m: float,
    time_from: datetime,
    time_to: datetime,
    vehicle_type: str | None,
    color: str | None,
    user: User | None = None,
) -> QueryExecution:
    if time_to < time_from:
        raise ValueError("time_to must be greater than or equal to time_from")

    operator = user or get_or_create_demo_user(db)
    nearby = find_nearby_devices(db, lat, lng, radius_m)
    device_ids = [item.device.id for item in nearby]
    device_by_id = {item.device.id: item.device for item in nearby}

    detections = fetch_candidate_detections(
        db, device_ids, time_from, time_to, vehicle_type, color
    )
    links = load_road_links_m(db, set(device_ids))
    points = detections_to_points(detections, device_by_id)
    routes = reconstruct_routes(
        points,
        links,
        vehicle_type=vehicle_type,
        color=color,
    )

    query = Query(
        user_id=operator.id,
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        time_from=time_from,
        time_to=time_to,
        vehicle_type=vehicle_type,
        color=color,
    )
    db.add(query)
    db.flush()
    route_ids = persist_route_results(db, query, routes)
    db.commit()
    db.refresh(query)

    return QueryExecution(
        query=query,
        nearby_devices=nearby,
        candidate_detections=detections,
        routes=routes,
        persisted_route_ids=route_ids,
    )
