"""Casos del dataset sintético de puntajes, solo cuando la base cargada es la de pruebas.

La consola los usa para llenar cámara, fecha, horario y filtros de cada caso. En la base
del piloto (sin cámaras `SC-`) la lista sale vacía y la consola no muestra el selector.
"""

from __future__ import annotations

from functools import lru_cache

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, require_operator
from ..db import get_db
from ..models import Device
from ..schemas import ScenarioRead
from ..scoring_dataset import COLOMBIA, DEFAULT_PATH, parse_timestamp, load_dataset

router = APIRouter(prefix="/api/v1/scenarios", tags=["scenarios"])


@lru_cache(maxsize=1)
def dataset_cases() -> tuple[ScenarioRead, ...]:
    cases = []
    for case in load_dataset(DEFAULT_PATH)["cases"]:
        start, end = (parse_timestamp(case[key]).astimezone(COLOMBIA) for key in ("time_from", "time_to"))
        cases.append(ScenarioRead(
            id=case["id"], title=case["title"], challenge=case["challenge"], camera_id=case["center_camera"],
            radius_m=case["radius_m"], date=start.date().isoformat(), time_from=start.strftime("%H:%M"),
            time_to=end.strftime("%H:%M"), vehicle_type=case["vehicle_type"], color=case["color"],
        ))
    return tuple(cases)


@router.get("", response_model=list[ScenarioRead])
def list_scenarios(_: Principal = Depends(require_operator), db: Session = Depends(get_db)) -> list[ScenarioRead]:
    loaded = set(db.scalars(select(Device.external_id).where(Device.external_id.startswith("SC-"))))
    if not loaded:
        return []
    try:
        return [case for case in dataset_cases() if case.camera_id in loaded]
    except (OSError, ValueError):
        return []  # Image without the dataset file: the console simply hides the picker.
