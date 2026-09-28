"""Adaptador idempotente entre Detection Envelope 1.1 y el modelo central."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Detection, Device, EdgeObservation, IngestedEvent
from .schemas import DetectionEnvelopeV11


class DeviceNotFoundError(ValueError):
    pass


class SequenceConflictError(ValueError):
    pass


@dataclass(frozen=True)
class IngestionResult:
    event_id: uuid.UUID
    duplicate: bool
    created_detections: int
    updated_detections: int


def ingest_detection_envelope(db: Session, payload: DetectionEnvelopeV11) -> IngestionResult:
    """Inserta un evento una vez y actualiza tracks repetidos sin duplicarlos."""
    existing_event = db.scalar(
        select(IngestedEvent).where(IngestedEvent.event_id == payload.event_id)
    )
    if existing_event is not None:
        return IngestionResult(payload.event_id, True, 0, 0)

    device = db.scalar(select(Device).where(Device.external_id == payload.camera_id))
    if device is None:
        raise DeviceNotFoundError(f"Unknown cameraId: {payload.camera_id}")

    sequence_owner = db.scalar(
        select(IngestedEvent).where(
            IngestedEvent.device_id == device.id,
            IngestedEvent.session_id == payload.session_id,
            IngestedEvent.sequence_number == payload.sequence_number,
        )
    )
    if sequence_owner is not None:
        raise SequenceConflictError(
            "sequenceNumber is already assigned to another event in this node session"
        )

    event = IngestedEvent(
        event_id=payload.event_id,
        device_id=device.id,
        session_id=payload.session_id,
        sequence_number=payload.sequence_number,
        schema_version=payload.schema_version,
        node_version=payload.node_version,
        model_name=payload.model,
        model_version=payload.model_version,
        model_digest=payload.model_digest,
        frame_number=payload.frame_number,
        generated_at=payload.generated_at,
        detection_count=len(payload.detections),
    )
    db.add(event)

    created = 0
    updated = 0
    for edge_detection in payload.detections:
        observation = db.scalar(
            select(EdgeObservation).where(
                EdgeObservation.device_id == device.id,
                EdgeObservation.session_id == payload.session_id,
                EdgeObservation.track_id == edge_detection.track_id,
                EdgeObservation.first_seen == edge_detection.first_seen,
            )
        )
        if observation is None:
            detection = Detection(
                device_id=device.id,
                track_id=edge_detection.track_id,
                vehicle_type=edge_detection.vehicle_type,
                color=edge_detection.color,
                direction=edge_detection.direction,
                confidence=edge_detection.confidence,
                observed_at=edge_detection.last_seen,
                thumbnail_url=None,
            )
            db.add(detection)
            db.flush()
            db.add(
                EdgeObservation(
                    device_id=device.id,
                    detection_id=detection.id,
                    session_id=payload.session_id,
                    track_id=edge_detection.track_id,
                    first_seen=edge_detection.first_seen,
                    last_seen=edge_detection.last_seen,
                    first_event_id=payload.event_id,
                    last_event_id=payload.event_id,
                )
            )
            created += 1
            continue

        detection = db.get(Detection, observation.detection_id)
        if detection is not None:
            detection.vehicle_type = edge_detection.vehicle_type
            detection.color = edge_detection.color
            detection.direction = edge_detection.direction
            detection.confidence = edge_detection.confidence
            detection.observed_at = edge_detection.last_seen
        observation.last_seen = edge_detection.last_seen
        observation.last_event_id = payload.event_id
        updated += 1

    if device.kind == "physical":
        device.status = "online"
    db.commit()
    return IngestionResult(payload.event_id, False, created, updated)
