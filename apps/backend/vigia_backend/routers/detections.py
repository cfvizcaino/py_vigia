"""CRUD HTTP de detecciones vehiculares."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Detection, Device
from ..schemas import DetectionCreate, DetectionRead, DetectionUpdate

router = APIRouter(prefix="/api/v1/detections", tags=["detections"])


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


@router.post("", response_model=DetectionRead, status_code=status.HTTP_201_CREATED)
def create_detection(payload: DetectionCreate, db: Session = Depends(get_db)) -> Detection:
    device = db.get(Device, payload.device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    detection = Detection(**payload.model_dump())
    db.add(detection)
    db.commit()
    db.refresh(detection)
    return detection


@router.patch("/{detection_id}", response_model=DetectionRead)
def update_detection(
    detection_id: uuid.UUID,
    payload: DetectionUpdate,
    db: Session = Depends(get_db),
) -> Detection:
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")

    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(detection, key, value)

    db.commit()
    db.refresh(detection)
    return detection


@router.delete("/{detection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_detection(detection_id: uuid.UUID, db: Session = Depends(get_db)) -> None:
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    db.delete(detection)
    db.commit()
