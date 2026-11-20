"""Eliminar un nodo edge: borrado lógico, tokens revocados y evidencia conservada."""

from __future__ import annotations

from datetime import datetime, timezone
from unittest.mock import patch
import uuid

from alembic import command
from sqlalchemy import create_engine, inspect, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
import pytest

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend.api import app
from vigia_backend.config import Settings
from vigia_backend.db import Base, get_db
from vigia_backend.device_credentials import issue
from vigia_backend.migrate import configuration, require_current, upgrade
from vigia_backend.models import Detection, Device, DeviceCredential, SecurityAudit, utc_now
from vigia_backend.query_service import find_nearby_devices
from vigia_backend.routers import ingest


@pytest.fixture
def setup():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for camera in ("CAM-01", "CAM-02"):
            db.add(Device(external_id=camera, name=camera, kind="physical", status="offline", lat=11.0, lng=-74.8))
        db.commit()
        device = db.scalar(select(Device).where(Device.external_id == "CAM-01"))
        db.add(Detection(device_id=device.id, track_id=1, vehicle_type="car", color="white", direction="norte",
                         confidence=0.9, observed_at=datetime(2026, 11, 1, 12, tzinfo=timezone.utc)))
        _, first = issue(db, "CAM-01")
        _, second = issue(db, "CAM-01")
        admin, operator = bearer(db, "admin"), bearer(db, "operator")
        db.commit()

        def get_test_db():
            yield db

        app.dependency_overrides[get_db] = get_test_db
        settings = Settings(database_url="sqlite://", cors_origins=(), ingest_api_token="", ingest_auth_mode="device")
        with patch.object(ingest, "settings", settings):
            yield {
                "db": db, "device_id": str(device.id), "secrets": (first, second),
                "admin": ASGITestClient(app, headers=admin), "operator": ASGITestClient(app, headers=operator),
                "node": ASGITestClient(app),
            }
        app.dependency_overrides.clear()
    engine.dispose()


def envelope(camera="CAM-01"):
    return {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()),
            "sequenceNumber": 1, "cameraId": camera, "generatedAt": utc_now().isoformat(),
            "nodeVersion": "0.2.0", "model": "yolo26n.pt", "modelVersion": "yolo26n.pt",
            "frameNumber": 1, "detections": []}


def test_operator_cannot_delete(setup):
    assert setup["operator"].delete(f"/api/v1/devices/{setup['device_id']}").status_code == 403
    assert setup["db"].get(Device, uuid.UUID(setup["device_id"])).deleted_at is None


def test_delete_is_soft_revokes_every_token_and_keeps_detections(setup):
    db, device_id = setup["db"], uuid.UUID(setup["device_id"])
    assert setup["admin"].delete(f"/api/v1/devices/{device_id}").status_code == 204

    device = db.get(Device, device_id)
    assert device is not None and device.deleted_at is not None and device.deleted_by is not None
    credentials = db.scalars(select(DeviceCredential).where(DeviceCredential.device_id == device_id)).all()
    assert len(credentials) == 2 and all(c.revoked_at is not None for c in credentials)
    assert len(db.scalars(select(Detection).where(Detection.device_id == device_id)).all()) == 1
    entry = db.scalar(select(SecurityAudit).where(SecurityAudit.action == "device.deleted"))
    assert entry.detail == {"camera": "CAM-01", "tokens_revoked": 2}

    # Ya eliminado: 404, igual que uno que nunca existió.
    assert setup["admin"].delete(f"/api/v1/devices/{device_id}").status_code == 404


def test_deleted_node_disappears_from_operation(setup):
    db, admin = setup["db"], setup["admin"]
    admin.delete(f"/api/v1/devices/{setup['device_id']}")

    assert [d["external_id"] for d in admin.get("/api/v1/devices").json()] == ["CAM-02"]
    assert admin.get(f"/api/v1/devices/{setup['device_id']}").status_code == 404
    assert admin.patch(f"/api/v1/devices/{setup['device_id']}", json={"name": "otro"}).status_code == 404
    assert admin.post("/api/v1/admin/devices/CAM-01/credentials", json={"days": 30}).status_code == 404
    assert [n.device.external_id for n in find_nearby_devices(db, 11.0, -74.8, 500)] == ["CAM-02"]


def test_old_tokens_stop_working_for_events_and_heartbeats(setup):
    node, first = setup["node"], setup["secrets"][0]
    headers = {"X-Vigia-Device-Token": first}
    assert node.post("/api/v1/ingest/detections", json=envelope(), headers=headers).status_code == 202

    setup["admin"].delete(f"/api/v1/devices/{setup['device_id']}")
    assert node.post("/api/v1/ingest/detections", json=envelope(), headers=headers).status_code == 401
    heartbeat = node.post("/api/v1/ingest/heartbeat", json={"cameraId": "CAM-01", "state": "running"}, headers=headers)
    assert heartbeat.status_code == 401


def test_token_left_unrevoked_is_still_rejected(setup):
    """Si un token se emitió en carrera con el borrado, authenticate lo rechaza igual."""
    db = setup["db"]
    device = db.get(Device, uuid.UUID(setup["device_id"]))
    device.deleted_at = utc_now()  # Borrado sin pasar por la API: los tokens siguen vigentes.
    db.commit()
    headers = {"X-Vigia-Device-Token": setup["secrets"][1]}
    assert setup["node"].post("/api/v1/ingest/detections", json=envelope(), headers=headers).status_code == 401


def test_recreating_deleted_id_conflicts_and_restore_brings_it_back_without_token(setup):
    admin, device_id = setup["admin"], setup["device_id"]
    admin.delete(f"/api/v1/devices/{device_id}")

    again = admin.post("/api/v1/devices", json={"external_id": "CAM-01", "name": "x", "kind": "physical",
                                                "status": "offline", "lat": 11.0, "lng": -74.8})
    assert again.status_code == 409 and f"/devices/{device_id}/restore" in again.json()["detail"]

    assert setup["operator"].post(f"/api/v1/devices/{device_id}/restore").status_code == 403
    restored = admin.post(f"/api/v1/devices/{device_id}/restore")
    assert restored.status_code == 200 and restored.json()["external_id"] == "CAM-01"
    assert admin.post(f"/api/v1/devices/{device_id}/restore").status_code == 409
    assert {d["external_id"] for d in admin.get("/api/v1/devices").json()} == {"CAM-01", "CAM-02"}

    # Vuelve sin token: los anteriores siguen revocados y hay que emitir uno nuevo.
    headers = {"X-Vigia-Device-Token": setup["secrets"][0]}
    assert setup["node"].post("/api/v1/ingest/detections", json=envelope(), headers=headers).status_code == 401
    assert admin.post("/api/v1/admin/devices/CAM-01/credentials", json={"days": 30}).status_code == 201


def test_migration_0009_downgrades_and_upgrades(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'vigia.db'}")
    upgrade(engine)
    with engine.begin() as connection:
        command.downgrade(configuration(connection), "0008")
        assert "deleted_at" not in {c["name"] for c in inspect(connection).get_columns("devices")}
    upgrade(engine)
    require_current(engine)
    assert {"deleted_at", "deleted_by"} <= {c["name"] for c in inspect(engine).get_columns("devices")}
