"""Placas leídas en el edge: dato personal (Ley 1581), con la misma política que los recortes.

El nodo vota el texto por track y lo envía en `licensePlate`. La central lo guarda en
`detections.license_plate` solo si tiene formato colombiano, lo olvida a los 7 días y
únicamente un admin lo ve o filtra por él (cada búsqueda queda auditada con la placa
enmascarada, porque la auditoría vive más que la placa).
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import update

from .models import Detection, Query, utc_now

# Same rule as apps/vision/vigia_vision/plate_ocr.py: cars ABC123, motorcycles ABC12D or ABC12.
COLOMBIAN_PLATE = re.compile(r"[A-Z]{3}[0-9]{3}|[A-Z]{3}[0-9]{2}[A-Z]?")
DEFAULT_RETENTION_DAYS = 7


def normalize_plate(value: str | None) -> str | None:
    """Mayúsculas sin espacios ni guiones; None si no es una placa colombiana."""
    if not value:
        return None
    text = re.sub(r"[^A-Za-z0-9]", "", value).upper()
    return text if COLOMBIAN_PLATE.fullmatch(text) else None


def mask_plate(plate: str) -> str:
    """Para la auditoría: conserva las letras y oculta los números (ABC123 → ABC•••)."""
    return plate[:3] + "•" * (len(plate) - 3)


def retention_days() -> int:
    days = int(os.getenv("PLATE_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS)))
    if days < 1:
        raise ValueError("PLATE_RETENTION_DAYS debe ser al menos 1")
    return days


def visible_plate(detection: Detection, *, now: datetime | None = None) -> str | None:
    """La placa mientras está dentro del plazo; la purga horaria puede no haber corrido aún."""
    if not detection.license_plate:
        return None
    created = detection.created_at
    if created.tzinfo is None:  # SQLite returns naive timestamps.
        created = created.replace(tzinfo=timezone.utc)
    return detection.license_plate if created >= (now or utc_now()) - timedelta(days=retention_days()) else None


def purge_plates(db, *, now: datetime | None = None) -> int:
    """Borra el texto de las placas vencidas; la detección (tipo, color, hora) se conserva."""
    cutoff = (now or utc_now()) - timedelta(days=retention_days())
    result = db.execute(
        update(Detection)
        .where(Detection.license_plate.is_not(None), Detection.created_at < cutoff)
        .values(license_plate=None)
        .execution_options(synchronize_session="fetch")
    )
    db.execute(
        update(Query)
        .where(Query.license_plate.is_not(None), Query.created_at < cutoff)
        .values(license_plate=None)
        .execution_options(synchronize_session="fetch")
    )
    db.commit()
    return result.rowcount or 0
