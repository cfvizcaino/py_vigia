"""Pruebas del adaptador idempotente Detection Envelope 1.1."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from vigia_backend.db import Base
from vigia_backend.ingestion import SequenceConflictError, ingest_detection_envelope
from vigia_backend.models import Detection, Device, IngestedEvent
from vigia_backend.schemas import DetectionEnvelopeV11


class IngestionTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        self.db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
        self.db.add(
            Device(
                external_id="CAM-01",
                name="Tapo",
                kind="physical",
                status="offline",
                lat=11.0131,
                lng=-74.8172,
                camera_model="Tapo C110",
            )
        )
        self.db.commit()
        self.session_id = uuid.uuid4()
        self.first_seen = datetime(2026, 9, 28, 14, 0, tzinfo=timezone.utc)

    def tearDown(self) -> None:
        self.db.close()

    def envelope(self, *, event_id: uuid.UUID, sequence: int, confidence: float = 0.8) -> DetectionEnvelopeV11:
        return DetectionEnvelopeV11.model_validate(
            {
                "schemaVersion": "1.1",
                "eventId": str(event_id),
                "sessionId": str(self.session_id),
                "sequenceNumber": sequence,
                "cameraId": "CAM-01",
                "generatedAt": (self.first_seen + timedelta(seconds=sequence)).isoformat(),
                "nodeVersion": "0.2.0",
                "model": "yolo26n.pt",
                "modelVersion": "yolo26n.pt",
                "modelDigest": None,
                "frameNumber": sequence * 10,
                "detections": [
                    {
                        "trackId": 7,
                        "vehicleType": "car",
                        "confidence": confidence,
                        "firstSeen": self.first_seen.isoformat(),
                        "lastSeen": (self.first_seen + timedelta(seconds=sequence)).isoformat(),
                        "direction": "izquierda-a-derecha",
                        "boundingBox": [1, 2, 30, 40],
                        "color": None,
                        "make": None,
                        "model": None,
                        "licensePlate": None,
                    }
                ],
            }
        )

    def test_retries_and_successive_snapshots_do_not_duplicate_tracks(self) -> None:
        first_id = uuid.uuid4()
        first = ingest_detection_envelope(self.db, self.envelope(event_id=first_id, sequence=1))
        duplicate = ingest_detection_envelope(self.db, self.envelope(event_id=first_id, sequence=1))
        updated = ingest_detection_envelope(
            self.db,
            self.envelope(event_id=uuid.uuid4(), sequence=2, confidence=0.93),
        )

        self.assertEqual((first.created_detections, first.updated_detections), (1, 0))
        self.assertTrue(duplicate.duplicate)
        self.assertEqual((updated.created_detections, updated.updated_detections), (0, 1))
        self.assertEqual(self.db.scalar(select(func.count()).select_from(Detection)), 1)
        self.assertEqual(self.db.scalar(select(func.count()).select_from(IngestedEvent)), 2)
        detection = self.db.scalar(select(Detection))
        self.assertIsNotNone(detection)
        self.assertEqual(detection.confidence, 0.93)

    def test_same_sequence_with_different_event_is_rejected(self) -> None:
        ingest_detection_envelope(self.db, self.envelope(event_id=uuid.uuid4(), sequence=1))
        with self.assertRaises(SequenceConflictError):
            ingest_detection_envelope(self.db, self.envelope(event_id=uuid.uuid4(), sequence=1))


if __name__ == "__main__":
    unittest.main()
