"""CRUD HTTP de dispositivos (cámaras): lectura para operadores, cambios solo admin."""

from __future__ import annotations

import uuid

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, audit, require_admin, require_operator
from ..db import get_db
from ..device_credentials import revoke_all
from ..liveness import device_read
from ..models import Device, utc_now
from ..road_network import sync_registered_device
from ..schemas import DeviceCreate, DeviceRead, DeviceUpdate

router = APIRouter(prefix="/api/v1/devices", tags=["devices"], dependencies=[Depends(require_operator)])


@router.get("", response_model=list[DeviceRead])
def list_devices(db: Session = Depends(get_db)) -> list[DeviceRead]:
    active = select(Device).where(Device.deleted_at.is_(None)).order_by(Device.external_id)
    return [device_read(device) for device in db.scalars(active).all()]


def _active_device(db: Session, device_id: uuid.UUID) -> Device:
    """Un nodo eliminado responde 404 igual que uno inexistente: para la operación ya no está."""
    device = db.get(Device, device_id)
    if device is None or device.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    return device


@router.get("/{device_id}", response_model=DeviceRead)
def get_device(device_id: uuid.UUID, db: Session = Depends(get_db)) -> DeviceRead:
    return device_read(_active_device(db, device_id))


@router.post("", response_model=DeviceRead, status_code=status.HTTP_201_CREATED)
def create_device(payload: DeviceCreate, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> DeviceRead:
    # external_id es el identificador estable compartido con web y nodos edge (CAM-01).
    existing = db.scalar(select(Device).where(Device.external_id == payload.external_id))
    if existing is not None and existing.deleted_at is not None:
        # El identificador sigue ligado a las detecciones del nodo eliminado: se restaura, no se recrea.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"external_id belongs to a deleted device; restore it with POST /api/v1/devices/{existing.id}/restore",
        )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="external_id already exists")

    device = Device(**payload.model_dump())
    db.add(device)
    audit(db, principal, "device.created", detail={"camera": payload.external_id})
    db.commit()
    db.refresh(device)
    _sync_links(db, principal, device)
    return device_read(device)


@router.patch("/{device_id}", response_model=DeviceRead)
def update_device(
    device_id: uuid.UUID, payload: DeviceUpdate, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)
) -> DeviceRead:
    device = _active_device(db, device_id)

    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(device, key, value)
    audit(db, principal, "device.updated", detail={"camera": device.external_id, "fields": sorted(changes)})
    db.commit()
    db.refresh(device)
    if "lat" in changes or "lng" in changes:
        _sync_links(db, principal, device)
    return device_read(device)


@router.delete("/{device_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_device(device_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> None:
    """Borrado lógico: el nodo sale de listados, mapas y rutas y sus tokens dejan de servir,
    pero sus detecciones se conservan como evidencia de las consultas ya hechas."""
    device = _active_device(db, device_id)
    device.deleted_at = utc_now()
    device.deleted_by = principal.user.id
    revoked = revoke_all(db, device, user_id=principal.user.id)
    audit(db, principal, "device.deleted", detail={"camera": device.external_id, "tokens_revoked": revoked})
    db.commit()


@router.post("/{device_id}/restore", response_model=DeviceRead)
def restore_device(device_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> DeviceRead:
    """Devuelve un nodo eliminado a la operación, sin token: el admin le emite uno nuevo."""
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Device not found")
    if device.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Device is not deleted")
    device.deleted_at = None
    device.deleted_by = None
    audit(db, principal, "device.restored", detail={"camera": device.external_id})
    db.commit()
    db.refresh(device)
    # Mientras estuvo eliminado pudieron registrarse cámaras nuevas: se recalculan sus enlaces.
    _sync_links(db, principal, device)
    return device_read(device)


def _sync_links(db: Session, principal: Principal, device: Device) -> None:
    """El alta o el traslado no fallan si OSRM no responde: la cámara ya quedó guardada."""
    try:
        result = sync_registered_device(db, device)
    except (httpx.HTTPError, ValueError) as exc:
        db.rollback()
        audit(db, principal, "device.links_sync_failed", detail={"camera": device.external_id, "error": str(exc)})
        db.commit()
        return
    if result is None:
        return
    audit(db, principal, "device.links_synced", detail={"camera": device.external_id, **result})
    db.commit()
