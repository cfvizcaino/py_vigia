"""Orquesta consulta: dispositivos cercanos → detecciones → algoritmo de rutas."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .geo import haversine_m
from .models import (
    Detection,
    DetectionConfirmation,
    Device,
    DeviceLink,
    Query,
    RouteResult,
    RouteResultDetection,
    SecurityAudit,
    User,
)
from .plates import mask_plate, visible_plate
from .routing import DetectionPoint, RoadOption, RouteCandidate, RoutingConfig, reconstruct_routes
import json
import os


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
    # detection id → "match" | "reject", from an admin looking at the recortes.
    confirmations: dict[str, str]


def find_nearby_devices(db: Session, lat: float, lng: float, radius_m: float) -> list[NearbyDevice]:
    nearby: list[NearbyDevice] = []
    for device in db.scalars(select(Device)).all():
        distance = haversine_m(lat, lng, device.lat, device.lng)
        if distance <= radius_m:
            nearby.append(NearbyDevice(device=device, distance_m=distance))
    nearby.sort(key=lambda item: item.distance_m)
    return nearby


def load_road_links_m(db: Session, device_ids: set[uuid.UUID]) -> dict:
    """Mapa (external_id_a, external_id_b) → metros; solo entre dispositivos candidatos."""
    if not device_ids:
        return {}
    devices = {
        d.id: d
        for d in db.scalars(select(Device).where(Device.id.in_(device_ids))).all()
    }
    links = {}
    for link in db.scalars(
        select(DeviceLink).where(
            DeviceLink.from_device_id.in_(device_ids),
            DeviceLink.to_device_id.in_(device_ids),
        )
    ).all():
        a = devices.get(link.from_device_id)
        b = devices.get(link.to_device_id)
        if a and b:
            if link.road_source == "osrm":
                endpoints = [[a.lng, a.lat], [b.lng, b.lat]]
                links[(a.external_id, b.external_id)] = [
                    RoadOption(**{key: item[key] for key in ("distance_m", "duration_s", "weight", "geometry", "source", "option_index")})
                    for item in (link.road_options or []) if item.get("endpoints") == endpoints
                ]
            else:
                links[(a.external_id, b.external_id)] = link.road_distance_m
    return links


def fetch_candidate_detections(
    db: Session,
    device_ids: list[uuid.UUID],
    time_from: datetime,
    time_to: datetime,
    vehicle_type: str | None,
    color: str | None,
    plate: str | None = None,
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
        # Unknown colour stays in: see reconstruct_routes.
        statement = statement.where(or_(Detection.color == color, Detection.color.is_(None)))
    if plate is not None:
        # Unread plates stay in, like unknown colours.
        statement = statement.where(or_(Detection.license_plate == plate, Detection.license_plate.is_(None)))
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
                plate=visible_plate(det),
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
                "explanation": route.explanation,
                "road_geometry": route.road_geometry,
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


def _routing_config() -> RoutingConfig:
    return RoutingConfig(**json.loads(os.getenv("ROUTING_CONFIG_JSON", "{}")))


def _solve(db: Session, query: Query, confirmations: dict[str, str]):
    """Dispositivos, candidatas y rutas de una consulta guardada, con sus confirmaciones."""
    nearby = find_nearby_devices(db, query.lat, query.lng, query.radius_m)
    device_ids = [item.device.id for item in nearby]
    device_by_id = {item.device.id: item.device for item in nearby}
    detections = fetch_candidate_detections(
        db, device_ids, query.time_from, query.time_to, query.vehicle_type, query.color, query.license_plate
    )
    links = load_road_links_m(db, set(device_ids))
    points = detections_to_points(detections, device_by_id)
    routes = reconstruct_routes(
        points,
        links,
        vehicle_type=query.vehicle_type,
        color=query.color,
        plate=query.license_plate,
        required_ids=frozenset(i for i, v in confirmations.items() if v == "match"),
        excluded_ids=frozenset(i for i, v in confirmations.items() if v == "reject"),
        config=_routing_config(),
    )
    return nearby, detections, routes


def query_confirmations(db: Session, query_id: uuid.UUID) -> dict[str, str]:
    rows = db.scalars(select(DetectionConfirmation).where(DetectionConfirmation.query_id == query_id)).all()
    return {str(row.detection_id): row.verdict for row in rows}


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
    user: User,
    plate: str | None = None,
) -> QueryExecution:
    if time_to < time_from:
        raise ValueError("time_to must be greater than or equal to time_from")

    query = Query(
        user_id=user.id,
        lat=lat,
        lng=lng,
        radius_m=radius_m,
        time_from=time_from,
        time_to=time_to,
        vehicle_type=vehicle_type,
        color=color,
        license_plate=plate,
    )
    nearby, detections, routes = _solve(db, query, {})
    db.add(query)
    db.flush()
    route_ids = persist_route_results(db, query, routes)
    # Same transaction: a stored query always has its audit entry (coordinates live in `queries`).
    detail = {"query": str(query.id), "radius_m": radius_m, "detections": len(detections), "routes": len(routes)}
    if plate:
        detail["plate"] = mask_plate(plate)  # The audit outlives the 7-day plate.
    db.add(SecurityAudit(action="query.executed", user_id=user.id, outcome="allowed", detail=detail))
    db.commit()
    db.refresh(query)

    return QueryExecution(
        query=query,
        nearby_devices=nearby,
        candidate_detections=detections,
        routes=routes,
        persisted_route_ids=route_ids,
        confirmations={},
    )


def recalculate_query(db: Session, query: Query) -> QueryExecution:
    """Vuelve a resolver una consulta guardada con sus confirmaciones y reemplaza sus rutas."""
    confirmations = query_confirmations(db, query.id)
    nearby, detections, routes = _solve(db, query, confirmations)
    old = db.scalars(select(RouteResult).where(RouteResult.query_id == query.id)).all()
    for row in old:
        for hop in db.scalars(select(RouteResultDetection).where(RouteResultDetection.route_result_id == row.id)).all():
            db.delete(hop)
        db.delete(row)
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
        confirmations=confirmations,
    )
