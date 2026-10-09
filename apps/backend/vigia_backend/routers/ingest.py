"""Recepción autenticable de eventos publicados por nodos edge."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import Settings
from ..db import get_db
from ..device_credentials import authenticate
from ..models import SecurityAudit
from ..ingestion import DeviceNotFoundError, SequenceConflictError, ingest_detection_envelope
from ..schemas import DetectionEnvelopeV11, IngestResponse

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])
settings = Settings.from_environment()


def verify_device_token(
    payload: DetectionEnvelopeV11,
    x_vigia_device_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    if settings.ingest_auth_mode == "legacy":
        expected = settings.ingest_api_token
        allowed = bool(expected and x_vigia_device_token and secrets.compare_digest(x_vigia_device_token.encode(), expected.encode()))
        reason = "invalid"
    else:
        allowed, reason = authenticate(db, x_vigia_device_token, payload.camera_id)
    if not allowed:
        db.add(SecurityAudit(action="ingest.denied", camera_id=payload.camera_id, outcome=reason))
        db.commit()
        code = status.HTTP_403_FORBIDDEN if reason == "wrong_camera" else status.HTTP_401_UNAUTHORIZED
        raise HTTPException(status_code=code, detail="Device credential rejected")


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
        try:
            result = ingest_detection_envelope(db, payload)
        except IntegrityError:
            # A concurrent retry of the same event (or track) committed first. Re-evaluate
            # against the committed state: it becomes "duplicate" or a sequence conflict.
            db.rollback()
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
