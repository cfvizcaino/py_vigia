"""Fase 4: etiquetas explícitas sobre recortes y su almacén privado de aprendizaje.

Un admin, al revisar un paso de ruta, puede etiquetar el recorte para dos tareas:

- **color:** uno de los 8 colores que reporta el clasificador, o `no_determinable`;
- **placa:** el texto exacto (formato colombiano), `ilegible` o `sin_placa`.

Solo esa acción explícita copia el recorte, antes de que venza a los 7 días, del
contenedor `recortes` a un contenedor aparte (`aprendizaje`) que no tiene la regla de
borrado de 7 días. La copia y la fila viven `DATASET_RETENTION_DAYS` (180 por defecto, a
falta de la política aprobada por los tutores); la limpieza horaria borra ambas.

Nunca se infiere una etiqueta: no revisar no es aceptar la predicción, y `match/reject`
de una ruta no dice nada del color ni de la placa. Ver docs/ROADMAP.md (fase 4).
"""

from __future__ import annotations

import hashlib
import os
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import Detection, Device, EdgeObservation, IngestedEvent, TrainingAnnotation, utc_now
from .plates import normalize_plate
from .thumbnails import AzureBlobStore, DirectoryStore, ThumbnailStore, is_expired, thumbnail_store

COLOR_LABELS = ("black", "blue", "brown", "gray", "green", "red", "white", "yellow")
NOT_DETERMINABLE = "no_determinable"
PLATE_UNREADABLE = "ilegible"
PLATE_ABSENT = "sin_placa"
TASKS = ("color", "plate")
DEFAULT_RETENTION_DAYS = 180


class AnnotationError(ValueError):
    """Etiqueta inválida (422) o recorte que ya no está (409)."""

    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


@lru_cache(maxsize=1)
def dataset_store() -> ThumbnailStore | None:
    """Mismo almacén que los recortes, en otro contenedor; None si no hay almacén."""
    connection = os.getenv("DATASET_STORAGE_CONNECTION_STRING", "").strip() or os.getenv(
        "THUMBNAIL_STORAGE_CONNECTION_STRING", "").strip()
    if connection:
        container = os.getenv("DATASET_CONTAINER", "aprendizaje").strip() or "aprendizaje"
        if container == (os.getenv("THUMBNAIL_CONTAINER", "recortes").strip() or "recortes"):
            raise ValueError("DATASET_CONTAINER no puede ser el contenedor de recortes (se borra a los 7 días)")
        return AzureBlobStore(connection, container, create=True)
    directory = os.getenv("DATASET_DIR", "").strip()
    return DirectoryStore(Path(directory)) if directory else None


def retention_days() -> int:
    days = int(os.getenv("DATASET_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS)))
    if days < 1:
        raise ValueError("DATASET_RETENTION_DAYS debe ser al menos 1")
    return days


def normalize_label(task: str, label: str) -> str:
    value = label.strip()
    if task == "color":
        value = value.lower()
        if value in COLOR_LABELS or value == NOT_DETERMINABLE:
            return value
        raise AnnotationError("Color no válido: usa uno de los 8 colores o «no_determinable».")
    if task == "plate":
        if value.lower() in (PLATE_UNREADABLE, PLATE_ABSENT):
            return value.lower()
        plate = normalize_plate(value)
        if plate is None:
            raise AnnotationError("Placa no válida: escribe el texto exacto (ABC123, ABC12D) o marca «ilegible» o «sin_placa».")
        return plate
    raise AnnotationError("Tarea no válida: color o plate.", 404)


def _model_digest(db: Session, detection: Detection) -> str | None:
    """Digest del modelo que produjo la detección, mientras el sobre crudo exista (7 días)."""
    event_id = db.scalar(select(EdgeObservation.last_event_id).where(EdgeObservation.detection_id == detection.id))
    if event_id is None:
        return None
    return db.scalar(select(IngestedEvent.model_digest).where(IngestedEvent.event_id == event_id))


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def save_annotation(db: Session, detection: Detection, task: str, label: str, user_id) -> TrainingAnnotation:
    """Guarda (o corrige) la etiqueta y copia el recorte al almacén de aprendizaje."""
    if task not in TASKS:
        raise AnnotationError("Tarea no válida: color o plate.", 404)
    value = normalize_label(task, label)
    source, target = thumbnail_store(), dataset_store()
    if source is None or target is None:
        raise AnnotationError("El centro no tiene almacén de recortes o de aprendizaje.", 501)
    data = None
    if detection.thumbnail_url and not is_expired(detection):
        data = source.get(detection.thumbnail_url)
    if data is None:
        raise AnnotationError("El recorte ya no está disponible (vence a los 7 días).", 409)

    digest = hashlib.sha256(data).hexdigest()
    key = f"{task}/{digest}.jpg"
    target.put(key, data)
    row = db.scalar(select(TrainingAnnotation).where(
        TrainingAnnotation.detection_id == detection.id, TrainingAnnotation.task == task))
    device = db.get(Device, detection.device_id)
    predicted = detection.color if task == "color" else detection.license_plate
    now = utc_now()
    if row is None:
        row = TrainingAnnotation(detection_id=detection.id, task=task, created_at=now)
        db.add(row)
    row.label = value
    row.predicted = predicted
    row.detection_confidence = detection.confidence
    row.model_digest = _model_digest(db, detection)
    row.camera_id = device.external_id if device else "desconocida"
    row.track_id = detection.track_id
    row.observed_at = _aware(detection.observed_at)
    row.image_sha256 = digest
    row.sample_key = key
    row.user_id = user_id
    row.updated_at = now
    db.flush()
    return row


def _release_sample(db: Session, key: str) -> None:
    """Borra la imagen si ninguna otra etiqueta la usa."""
    if db.scalar(select(func.count()).select_from(TrainingAnnotation).where(TrainingAnnotation.sample_key == key)):
        return
    store = dataset_store()
    if store is not None:
        store.delete(key)


def delete_annotation(db: Session, detection_id, task: str) -> bool:
    row = db.scalar(select(TrainingAnnotation).where(
        TrainingAnnotation.detection_id == detection_id, TrainingAnnotation.task == task))
    if row is None:
        return False
    key = row.sample_key
    db.delete(row)
    db.flush()
    _release_sample(db, key)
    return True


def annotations_for(db: Session, detection_ids) -> dict:
    """{detection_id: {task: label}} para marcar en la consola lo ya etiquetado."""
    ids = list(detection_ids)
    if not ids:
        return {}
    result: dict = {}
    for row in db.scalars(select(TrainingAnnotation).where(TrainingAnnotation.detection_id.in_(ids))):
        result.setdefault(row.detection_id, {})[row.task] = row.label
    return result


def summary(db: Session) -> dict:
    """Conteos por tarea y etiqueta, sin textos de placa (dato personal)."""
    counts: dict = {task: {} for task in TASKS}
    rows = db.execute(select(TrainingAnnotation.task, TrainingAnnotation.label, func.count()).group_by(
        TrainingAnnotation.task, TrainingAnnotation.label)).all()
    for task, label, count in rows:
        bucket = label if task == "color" or label in (PLATE_UNREADABLE, PLATE_ABSENT) else "texto"
        counts.setdefault(task, {})[bucket] = counts.get(task, {}).get(bucket, 0) + count
    corrected = db.scalar(select(func.count()).select_from(TrainingAnnotation).where(
        TrainingAnnotation.predicted.is_not(None), TrainingAnnotation.predicted != TrainingAnnotation.label)) or 0
    return {"counts": counts, "corrected": corrected, "retention_days": retention_days()}


def purge_annotations(db: Session, *, now: datetime | None = None) -> int:
    cutoff = (now or utc_now()) - timedelta(days=retention_days())
    rows = list(db.scalars(select(TrainingAnnotation).where(TrainingAnnotation.created_at < cutoff)))
    keys = {row.sample_key for row in rows}
    for row in rows:
        db.delete(row)
    db.flush()
    for key in keys:
        _release_sample(db, key)
    db.commit()
    return len(rows)
