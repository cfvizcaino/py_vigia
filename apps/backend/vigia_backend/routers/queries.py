"""Endpoint de consulta de trayectorias estimadas."""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..db import get_db
from ..query_service import execute_query
from ..schemas import (
    NearbyDeviceRead,
    QueryExecuteResponse,
    QueryRead,
    RouteCandidateRead,
    RouteDetectionHop,
)

router = APIRouter(prefix="/api/v1/queries", tags=["queries"])


@router.get("", response_model=QueryExecuteResponse)
def run_query(
    lat: float = Query(..., description="Latitud del punto de interés"),
    lng: float = Query(..., description="Longitud del punto de interés"),
    radius_m: float = Query(2000.0, gt=0, le=50_000, description="Radio Haversine en metros"),
    time_from: datetime = Query(..., description="Inicio de la ventana temporal (ISO-8601)"),
    time_to: datetime = Query(..., description="Fin de la ventana temporal (ISO-8601)"),
    vehicle_type: str | None = Query(default=None, pattern="^(car|motorcycle)$"),
    color: str | None = Query(default=None, min_length=1, max_length=64),
    db: Session = Depends(get_db),
) -> QueryExecuteResponse:
    """Selecciona dispositivos cercanos, detecciones candidatas y rutas estimadas."""
    try:
        result = execute_query(
            db,
            lat=lat,
            lng=lng,
            radius_m=radius_m,
            time_from=time_from,
            time_to=time_to,
            vehicle_type=vehicle_type,
            color=color,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    detection_by_id = {str(d.id): d for d in result.candidate_detections}
    device_ext = {item.device.id: item.device.external_id for item in result.nearby_devices}

    routes_out: list[RouteCandidateRead] = []
    for route, route_id in zip(result.routes, result.persisted_route_ids, strict=True):
        hops: list[RouteDetectionHop] = []
        for order, det_id in enumerate(route.detection_ids):
            det = detection_by_id[det_id]
            hops.append(
                RouteDetectionHop(
                    sequence_order=order,
                    detection_id=det.id,
                    camera_id=device_ext[det.device_id],
                    vehicle_type=det.vehicle_type,
                    color=det.color,
                    direction=det.direction,
                    confidence=det.confidence,
                    observed_at=det.observed_at,
                )
            )
        routes_out.append(
            RouteCandidateRead(
                id=route_id,
                rank=route.rank,
                confidence=route.confidence,
                has_distant_gaps=route.has_distant_gaps,
                camera_ids=list(route.camera_ids),
                vehicle_type=route.vehicle_type,
                color=route.color,
                detections=hops,
            )
        )

    return QueryExecuteResponse(
        query=QueryRead.model_validate(result.query),
        nearby_devices=[
            NearbyDeviceRead(
                id=item.device.id,
                external_id=item.device.external_id,
                name=item.device.name,
                lat=item.device.lat,
                lng=item.device.lng,
                distance_m=round(item.distance_m, 1),
            )
            for item in result.nearby_devices
        ],
        candidate_detection_count=len(result.candidate_detections),
        routes=routes_out,
    )
