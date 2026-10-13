"""Los sobres viejos se borran; las detecciones que consulta el operador no."""
import uuid
from datetime import timedelta

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from vigia_backend.db import Base
from vigia_backend.models import Detection, Device, IngestedEvent, utc_now
from vigia_backend.retention import purge_raw_events


def test_old_envelopes_are_deleted_and_detections_remain():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        device = Device(external_id="CAM-01", name="Tapo", kind="physical", status="online", lat=11, lng=-74.8)
        db.add(device)
        db.flush()
        now = utc_now()
        db.add(Detection(
            device_id=device.id, vehicle_type="car", direction="indeterminada",
            confidence=0.9, observed_at=now - timedelta(days=8),
        ))
        session_id = uuid.uuid4()
        db.add(IngestedEvent(
            event_id=uuid.uuid4(), device_id=device.id, session_id=session_id, sequence_number=1,
            schema_version="1.1", node_version="0.2.0", model_name="yolo26n.pt", model_version="yolo26n.pt",
            frame_number=1, generated_at=now - timedelta(days=8), detection_count=1,
            received_at=now - timedelta(days=8),
        ))
        db.add(IngestedEvent(
            event_id=uuid.uuid4(), device_id=device.id, session_id=session_id, sequence_number=2,
            schema_version="1.1", node_version="0.2.0", model_name="yolo26n.pt", model_version="yolo26n.pt",
            frame_number=2, generated_at=now, detection_count=0, received_at=now,
        ))
        db.commit()
        assert purge_raw_events(db, now=now, days=7) == 1
        assert db.scalar(select(func.count()).select_from(IngestedEvent)) == 1
        assert db.scalar(select(func.count()).select_from(Detection)) == 1
