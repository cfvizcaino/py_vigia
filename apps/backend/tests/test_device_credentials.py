from datetime import timedelta
import json
from unittest.mock import patch
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import pytest

from tests.asgi_client import ASGITestClient
from vigia_backend.api import app
from vigia_backend.config import Settings
from vigia_backend.db import Base, get_db
from vigia_backend.device_credentials import issue, revoke
from vigia_backend.models import Device, DeviceCredential, IngestedEvent, SecurityAudit, utc_now
from vigia_backend.routers import ingest


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for camera in ("CAM-01", "CAM-02"):
            db.add(Device(external_id=camera, name=camera, kind="physical", status="offline", lat=11, lng=-74))
        db.commit()
        credential, secret = issue(db, "CAM-01")
        db.commit()
        def get_test_db():
            yield db
        app.dependency_overrides[get_db] = get_test_db
        settings = Settings(database_url="sqlite://", cors_origins=(), ingest_api_token="legacy-secret", ingest_auth_mode="device")
        with patch.object(ingest, "settings", settings):
            yield db, credential, secret, ASGITestClient(app)
        app.dependency_overrides.clear()
    engine.dispose()


def envelope(camera="CAM-01"):
    return {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()),
            "sequenceNumber": 1, "cameraId": camera, "generatedAt": utc_now().isoformat(),
            "nodeVersion": "0.2.0", "model": "yolo26n.pt", "modelVersion": "yolo26n.pt",
            "frameNumber": 1, "detections": []}


def send(client, payload, secret=None):
    return client.post("/api/v1/ingest/detections", json=payload,
                       headers={"X-Vigia-Device-Token": secret} if secret else {})


def test_valid_token_and_retry_are_accepted(setup):
    db, credential, secret, client = setup
    body = envelope()
    assert send(client, body, secret).status_code == 202
    assert send(client, body, secret).json()["status"] == "duplicate"
    assert len(db.scalars(select(IngestedEvent)).all()) == 1
    assert credential.token_hash != secret
    assert secret not in credential.token_hash


@pytest.mark.parametrize("token", [None, "wrong", "legacy-secret"])
def test_anonymous_invalid_and_shared_token_fail_closed(setup, token):
    db, _, _, client = setup
    assert send(client, envelope(), token).status_code == 401
    assert not db.scalars(select(IngestedEvent)).all()
    assert db.scalars(select(SecurityAudit).where(SecurityAudit.action == "ingest.denied")).one().outcome == "invalid"


def test_node_cannot_impersonate_another_camera_even_with_replayed_event(setup):
    db, _, secret, client = setup
    body = envelope()
    assert send(client, body, secret).status_code == 202
    body["cameraId"] = "CAM-02"
    assert send(client, body, secret).status_code == 403
    assert len(db.scalars(select(IngestedEvent)).all()) == 1


def test_revocation_blocks_new_events_and_retries(setup):
    db, credential, secret, client = setup
    body = envelope()
    assert send(client, body, secret).status_code == 202
    revoke(db, credential.id)
    db.commit()
    assert send(client, body, secret).status_code == 401
    assert send(client, envelope(), secret).status_code == 401


def test_expired_token_is_rejected(setup):
    db, credential, secret, client = setup
    credential.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert send(client, envelope(), secret).status_code == 401


def test_rotation_allows_overlap_then_independent_revocation(setup):
    db, credential, old_secret, client = setup
    _, new_secret = issue(db, "CAM-01")
    db.commit()
    assert send(client, envelope(), old_secret).status_code == 202
    assert send(client, envelope(), new_secret).status_code == 202
    revoke(db, credential.id)
    db.commit()
    assert send(client, envelope(), new_secret).status_code == 202
    assert send(client, envelope(), old_secret).status_code == 401
    audits = [{"action": r.action, "camera": r.camera_id, "outcome": r.outcome} for r in db.scalars(select(SecurityAudit))]
    assert old_secret not in json.dumps(audits) and new_secret not in json.dumps(audits)


def test_different_credential_cannot_reuse_other_cameras_event_id(setup):
    db, _, secret, client = setup
    body = envelope()
    assert send(client, body, secret).status_code == 202
    _, other_secret = issue(db, "CAM-02")
    db.commit()
    body["cameraId"] = "CAM-02"
    assert send(client, body, other_secret).status_code == 409


def test_legacy_requires_explicit_mode_and_nonempty_token():
    with patch("vigia_backend.config.load_dotenv"), patch.dict("os.environ", {"INGEST_AUTH_MODE": "legacy", "INGEST_API_TOKEN": ""}):
        with pytest.raises(ValueError):
            Settings.from_environment()


def test_issue_rejects_unknown_camera_and_invalid_expiry(setup):
    db, _, _, _ = setup
    with pytest.raises(ValueError):
        issue(db, "CAM-MISSING")
    with pytest.raises(ValueError):
        issue(db, "CAM-01", days=0)
    assert len(db.scalars(select(DeviceCredential)).all()) == 1
