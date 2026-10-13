"""Borra eventos crudos viejos. Las detecciones (lo que consulta el operador) se quedan."""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from sqlalchemy import delete

from .models import IngestedEvent, utc_now

DEFAULT_RETENTION_DAYS = 7


def retention_days() -> int:
    days = int(os.getenv("RAW_EVENT_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS)))
    if days < 1:
        raise ValueError("RAW_EVENT_RETENTION_DAYS debe ser al menos 1")
    return days


def purge_raw_events(db, *, now: datetime | None = None, days: int | None = None) -> int:
    """Quita sobres ya reconocidos. Un reintento posterior al plazo se vuelve a aceptar.

    La cola del edge reintenta mientras no haya acuse; el plazo cubre un corte largo
    y acota el crecimiento (un latido cada 2 s, de las 10 cámaras, proyectaba ≈160 MB/día).
    """
    cutoff = (now or utc_now()) - timedelta(days=days if days is not None else retention_days())
    result = db.execute(delete(IngestedEvent).where(IngestedEvent.received_at < cutoff))
    db.commit()
    return result.rowcount or 0
