"""CRUD HTTP de detecciones: lectura para operadores; altas/correcciones manuales solo admin."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, audit, require_admin, require_operator
from ..db import get_db
from ..models import Detection, Device
from ..schemas import DetectionCreate, DetectionRead, DetectionUpdate
from ..thumbnails import is_expired, thumbnail_store

router = APIRouter(prefix="/api/v1/detections", tags=["detections"], dependencies=[Depends(require_operator)])


@router.get("", response_model=list[DetectionRead])
def list_detections(
    device_id: uuid.UUID | None = None,
    vehicle_type: str | None = None,
    color: str | None = None,
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> list[Detection]:
    # Filtros opcionales para alimentar consultas y el algoritmo de rutas.
    statement = select(Detection).order_by(Detection.observed_at.desc()).limit(limit)
    if device_id is not None:
        statement = statement.where(Detection.device_id == device_id)
    if vehicle_type is not None:
        statement = statement.where(Detection.vehicle_type == vehicle_type)
    if color is not None:
        statement = statement.where(Detection.color == color)
    return list(db.scalars(statement).all())


@router.get("/{detection_id}", response_model=DetectionRead)
def get_detection(detection_id: uuid.UUID, db: Session = Depends(get_db)) -> Detection:
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    return detection


@router.get("/{detection_id}/thumbnail", response_class=Response)
def get_thumbnail(
    detection_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)
) -> Response:
    """Recorte del vehículo para confirmar la detección a mano. Solo admin; cada vista se audita."""
    detection = db.get(Detection, detection_id)
    store = thumbnail_store()
    data = None
    if detection is not None and detection.thumbnail_url and store is not None and not is_expired(detection):
        data = store.get(detection.thumbnail_url)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No thumbnail")
    audit(db, principal, "thumbnail.viewed", detail={"detection": str(detection_id)})
    db.commit()
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "private, no-store"})


@router.post("", response_model=DetectionRead, status_code=status.HTTP_201_CREATED)
def create_detection(payload: DetectionCreate, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> Detection:
    device = db.get(Device, payload.device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    detection = Detection(**payload.model_dump())
    db.add(detection)
    db.flush()
    audit(db, principal, "detection.created", detail={"detection": str(detection.id), "camera": device.external_id})
    db.commit()
    db.refresh(detection)
    return detection


@router.patch("/{detection_id}", response_model=DetectionRead)
def update_detection(
    detection_id: uuid.UUID,
    payload: DetectionUpdate,
    principal: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
) -> Detection:
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")

    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(detection, key, value)
    audit(db, principal, "detection.updated", detail={"detection": str(detection_id), "fields": sorted(changes)})
    db.commit()
    db.refresh(detection)
    return detection


@router.delete("/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_detection(detection_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> None:
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    db.delete(detection)
    audit(db, principal, "detection.deleted", detail={"detection": str(detection_id)})
    db.commit()
