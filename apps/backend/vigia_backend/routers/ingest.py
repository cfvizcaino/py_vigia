"""Recepción autenticable de eventos publicados por nodos edge."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..ingestion import DeviceNotFoundError, SequenceConflictError, ingest_detection_envelope
from ..schemas import DetectionEnvelopeV11, IngestResponse

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])
settings = Settings.from_environment()


def verify_device_token(x_vigia_device_token: str | None = Header(default=None)) -> None:
    expected = settings.ingest_api_token
    if expected is None:
        return
    if x_vigia_device_token is None or not secrets.compare_digest(x_vigia_device_token, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid device token")


@router.post(
    "/detections",
    response_model=IngestResponse,
    status_code=status.HTTP_202_ACCEPTED,
    dependencies=[Depends(verify_device_token)],
)
def ingest_detections(
    payload: DetectionEnvelopeV11,
    db: Session = Depends(get_db),
) -> IngestResponse:
    try:
        result = ingest_detection_envelope(db, payload)
    except DeviceNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except SequenceConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    return IngestResponse(
        event_id=payload.event_id,
        status="duplicate" if result.duplicate else "accepted",
        created_detections=result.created_detections,
        updated_detections=result.updated_detections,
    )
