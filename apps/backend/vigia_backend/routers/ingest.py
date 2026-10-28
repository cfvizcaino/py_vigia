"""Recepción autenticable de eventos publicados por nodos edge."""

from __future__ import annotations

import secrets
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ..config import Settings
from ..db import get_db
from ..device_credentials import authenticate
from ..models import Detection, Device, EdgeObservation, SecurityAudit
from ..ingestion import DeviceNotFoundError, SequenceConflictError, ingest_detection_envelope
from ..schemas import DetectionEnvelopeV11, IngestResponse, ThumbnailResponse
from ..thumbnails import MAX_BYTES, looks_like_jpeg, thumbnail_key, thumbnail_store

router = APIRouter(prefix="/api/v1/ingest", tags=["ingest"])
settings = Settings.from_environment()


def _check_device(db: Session, token: str | None, camera_id: str) -> None:
    if settings.ingest_auth_mode == "legacy":
        expected = settings.ingest_api_token
        allowed = bool(expected and token and secrets.compare_digest(token.encode(), expected.encode()))
        reason = "invalid"
    else:
        allowed, reason = authenticate(db, token, camera_id)
    if not allowed:
        db.add(SecurityAudit(action="ingest.denied", camera_id=camera_id, outcome=reason))
        db.commit()
        code = status.HTTP_403_FORBIDDEN if reason == "wrong_camera" else status.HTTP_401_UNAUTHORIZED
        raise HTTPException(status_code=code, detail="Device credential rejected")


def verify_device_token(
    payload: DetectionEnvelopeV11,
    x_vigia_device_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> None:
    _check_device(db, x_vigia_device_token, payload.camera_id)


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


@router.post("/thumbnails", response_model=ThumbnailResponse, status_code=status.HTTP_201_CREATED)
async def ingest_thumbnail(
    request: Request,
    camera_id: str = Query(alias="cameraId", min_length=1, max_length=64),
    session_id: uuid.UUID = Query(alias="sessionId"),
    track_id: int = Query(alias="trackId", ge=0),
    first_seen: datetime = Query(alias="firstSeen"),
    x_vigia_device_token: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> ThumbnailResponse:
    """Recorte JPEG de un track ya publicado. El edge lo envía después del sobre que lo crea.

    404 si el track no existe: el edge no debe reintentarlo. 501 si el centro no guarda
    recortes: el edge deja de enviarlos (503 queda para la sobrecarga, que sí se reintenta).
    """
    if request.headers.get("content-type", "").split(";")[0].strip() != "image/jpeg":
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Send image/jpeg")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(status_code=413, detail=f"Max {MAX_BYTES} bytes")
    # Database and storage calls block: keep them off the event loop.
    return await run_in_threadpool(
        _store_thumbnail, db, x_vigia_device_token, camera_id, session_id, track_id, first_seen, bytes(data)
    )


def _store_thumbnail(
    db: Session,
    token: str | None,
    camera_id: str,
    session_id: uuid.UUID,
    track_id: int,
    first_seen: datetime,
    data: bytes,
) -> ThumbnailResponse:
    _check_device(db, token, camera_id)
    store = thumbnail_store()
    if store is None:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Thumbnails are disabled")
    if not looks_like_jpeg(data):
        raise HTTPException(status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, detail="Not a JPEG")
    detection = db.scalar(
        select(Detection)
        .join(EdgeObservation, EdgeObservation.detection_id == Detection.id)
        .join(Device, Device.id == EdgeObservation.device_id)
        .where(
            Device.external_id == camera_id,
            EdgeObservation.session_id == session_id,
            EdgeObservation.track_id == track_id,
            EdgeObservation.first_seen == first_seen,
        )
    )
    if detection is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown track")
    key = thumbnail_key(camera_id, session_id, track_id, first_seen)
    store.put(key, data)
    detection.thumbnail_url = key
    db.commit()
    return ThumbnailResponse(detection_id=detection.id)
