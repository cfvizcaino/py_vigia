"""Estado real de los nodos: latido, segundo plano, detenido y sin señal."""

from datetime import timedelta
from unittest.mock import patch
import uuid

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import pytest

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend.api import app
from vigia_backend.config import Settings
from vigia_backend.db import Base, get_db
from vigia_backend.device_credentials import issue
from vigia_backend.liveness import activity_state, effective_status
from vigia_backend.models import Device, utc_now
from vigia_backend.routers import ingest


def device(**fields) -> Device:
    base = {"external_id": "CEL-02", "name": "Teléfono", "kind": "physical", "status": "offline", "lat": 11, "lng": -74}
    return Device(**{**base, **fields})


def test_states_from_heartbeat_and_events():
    now = utc_now()
    assert activity_state(device(), now) == "never"
    assert activity_state(device(kind="simulated", status="simulated"), now) == "simulated"
    running = device(last_heartbeat_at=now - timedelta(seconds=40), runtime_state="running")
    assert activity_state(running, now) == "active"
    assert effective_status(running, now) == "online"
    # Three missed heartbeats while it said it was detecting: the app was killed or lost network.
    silent = device(last_heartbeat_at=now - timedelta(seconds=120), runtime_state="running")
    assert activity_state(silent, now) == "no_signal"
    assert effective_status(silent, now) == "offline"
    assert activity_state(device(last_heartbeat_at=now - timedelta(hours=2), runtime_state="paused"), now) == "background"
    assert activity_state(device(last_heartbeat_at=now - timedelta(seconds=5), runtime_state="stopped"), now) == "stopped"
    assert effective_status(device(last_heartbeat_at=now, runtime_state="paused"), now) == "offline"


def test_nodes_without_heartbeat_use_their_last_event():
    now = utc_now()
    # They send an empty envelope every 30 s while running; closing the app stops them.
    assert activity_state(device(last_event_at=now - timedelta(seconds=60)), now) == "active"
    assert activity_state(device(last_event_at=now - timedelta(minutes=3)), now) == "no_signal"
    # Events keep arriving long after the last heartbeat (heartbeats failing): still active.
    stale_heartbeat = device(last_heartbeat_at=now - timedelta(minutes=20), runtime_state="running",
                             last_event_at=now - timedelta(seconds=10))
    assert activity_state(stale_heartbeat, now) == "active"


@pytest.fixture
def client():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for camera in ("CEL-02", "CEL-03"):
            db.add(Device(external_id=camera, name=camera, kind="physical", status="online", lat=11, lng=-74))
        db.commit()
        _, secret = issue(db, "CEL-02")
        headers = bearer(db, "operator")
        db.commit()

        def get_test_db():
            yield db

        app.dependency_overrides[get_db] = get_test_db
        settings = Settings(database_url="sqlite://", cors_origins=(), ingest_api_token=None, ingest_auth_mode="device")
        with patch.object(ingest, "settings", settings):
            yield db, secret, ASGITestClient(app, headers=headers)
        app.dependency_overrides.clear()
    engine.dispose()


def beat(client, secret, **fields):
    body = {"cameraId": "CEL-02", "state": "running", "nodeVersion": "1.5.0", "analysesPerSecond": 6.2,
            "activeTracks": 3, "pendingEvents": 0, "deliveredEvents": 120, "sessionId": str(uuid.uuid4()), **fields}
    return client.post("/api/v1/ingest/heartbeat", json=body, headers={"X-Vigia-Device-Token": secret} if secret else {})


def by_camera(client):
    return {d["external_id"]: d for d in client.get("/api/v1/devices").json()}


def test_heartbeat_is_reflected_in_the_device_list(client):
    db, secret, http = client
    # A node registered as "online" by hand but never heard from is not online.
    assert by_camera(http)["CEL-02"]["status"] == "offline"
    assert by_camera(http)["CEL-02"]["activity"]["state"] == "never"

    response = beat(http, secret)
    assert response.status_code == 200
    assert response.json()["interval_seconds"] == 30
    listed = by_camera(http)["CEL-02"]
    assert listed["status"] == "online"
    assert listed["activity"]["state"] == "active"
    assert listed["activity"]["node_version"] == "1.5.0"
    assert listed["activity"]["analyses_per_second"] == 6.2
    assert listed["activity"]["pending_events"] == 0

    assert beat(http, secret, state="paused").status_code == 200
    assert by_camera(http)["CEL-02"]["activity"]["state"] == "background"
    assert beat(http, secret, state="stopped").status_code == 200
    assert by_camera(http)["CEL-02"]["activity"]["state"] == "stopped"


def test_heartbeat_requires_the_camera_token(client):
    _, secret, http = client
    assert beat(http, None).status_code == 401
    assert beat(http, "otro-token").status_code == 401
    assert beat(http, secret, cameraId="CEL-03").status_code == 403
    assert beat(http, secret, state="dancing").status_code == 422


def test_an_accepted_envelope_counts_as_contact(client):
    db, secret, http = client
    envelope = {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()),
                "sequenceNumber": 1, "cameraId": "CEL-02", "generatedAt": utc_now().isoformat(),
                "nodeVersion": "1.4.0", "model": "yolo", "modelVersion": "yolo", "frameNumber": 1, "detections": []}
    assert http.post("/api/v1/ingest/detections", json=envelope, headers={"X-Vigia-Device-Token": secret}).status_code == 202
    listed = by_camera(http)["CEL-02"]
    assert listed["activity"]["state"] == "active"
    assert listed["activity"]["node_version"] == "1.4.0"
    assert listed["activity"]["last_event_at"] is not None
