"""CRUD HTTP de dispositivos (cámaras): lectura para operadores, cambios solo admin."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, audit, require_admin, require_operator
from ..db import get_db
from ..models import Device
from ..schemas import DeviceCreate, DeviceRead, DeviceUpdate

router = APIRouter(prefix="/api/v1/devices", tags=["devices"], dependencies=[Depends(require_operator)])


@router.get("", response_model=list[DeviceRead])
def list_devices(db: Session = Depends(get_db)) -> list[Device]:
    return list(db.scalars(select(Device).order_by(Device.external_id)).all())


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(device_id: uuid.UUID, db: Session = Depends(get_db)) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
def create_device(payload: DeviceCreate, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> Device:
    # external_id es el identificador estable compartido con web y nodos edge (CAM-01).
    existing = db.scalar(select(Device).where(Device.external_id == payload.external_id))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="external_id already exists")

    device = Device(**payload.model_dump())
    db.add(device)
    audit(db, principal, "device.created", detail={"camera": payload.external_id})
    db.commit()
    db.refresh(device)
    return device


@router.patch("/{device_id}", response_model=DeviceRead)
def update_device(
    device_id: uuid.UUID, payload: DeviceUpdate, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)
) -> Device:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")

    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(device, key, value)
    audit(db, principal, "device.updated", detail={"camera": device.external_id, "fields": sorted(changes)})
    db.commit()
    db.refresh(device)
    return device


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(device_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> None:
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    db.delete(device)
    audit(db, principal, "device.deleted", detail={"camera": device.external_id})
    db.commit()
