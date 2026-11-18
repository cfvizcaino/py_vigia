"""CRUD HTTP de detecciones: lectura para operadores; altas/correcciones manuales solo admin."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, audit, require_admin, require_operator
from ..db import get_db
from ..dataset import AnnotationError, delete_annotation, save_annotation
from ..models import Detection, Device, TrainingAnnotation
from ..schemas import AnnotationRead, AnnotationWrite, DetectionCreate, DetectionRead, DetectionUpdate
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


def _annotation_read(row: TrainingAnnotation) -> AnnotationRead:
    return AnnotationRead(task=row.task, label=row.label, predicted=row.predicted, updated_at=row.updated_at)


@router.get("/{detection_id}/annotations", response_model=list[AnnotationRead])
def list_annotations(
    detection_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)
) -> list[AnnotationRead]:
    """Etiquetas de aprendizaje ya guardadas para este recorte (fase 4). Solo admin."""
    rows = db.scalars(select(TrainingAnnotation).where(TrainingAnnotation.detection_id == detection_id))
    return [_annotation_read(row) for row in rows]


@router.put("/{detection_id}/annotations/{task}", response_model=AnnotationRead)
def put_annotation(
    detection_id: uuid.UUID,
    task: str,
    body: AnnotationWrite,
    principal: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
) -> AnnotationRead:
    """Un admin etiqueta el recorte para entrenar: color (o no_determinable) o placa (o ilegible/sin_placa).

    Copia el recorte al almacén de aprendizaje antes de que venza. La auditoría no guarda el
    texto de la placa (dato personal), solo la tarea y si corrigió la predicción.
    """
    detection = db.get(Detection, detection_id)
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Detection not found")
    try:
        row = save_annotation(db, detection, task, body.label, principal.user.id)
    except AnnotationError as exc:
        db.rollback()
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    detail = {"detection": str(detection_id), "task": task, "corrected": row.predicted != row.label}
    if task == "color":
        detail["label"] = row.label
    audit(db, principal, "annotation.saved", detail=detail)
    db.commit()
    return _annotation_read(row)


@router.delete("/{detection_id}/annotations/{task}", status_code=status.HTTP_204_NO_CONTENT)
def remove_annotation(
    detection_id: uuid.UUID, task: str, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)
) -> None:
    if delete_annotation(db, detection_id, task):
        audit(db, principal, "annotation.deleted", detail={"detection": str(detection_id), "task": task})
    db.commit()


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
