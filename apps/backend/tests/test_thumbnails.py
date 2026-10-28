"""Recortes: el edge sube uno por track, solo un admin lo ve y vencen a los 7 días."""

from datetime import timedelta
from unittest.mock import patch
import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend.api import app
from vigia_backend.config import Settings
from vigia_backend.db import Base, get_db
from vigia_backend.device_credentials import issue
from vigia_backend.models import Detection, Device, SecurityAudit, utc_now
from vigia_backend.routers import ingest
from vigia_backend.thumbnails import purge_thumbnails, thumbnail_key, thumbnail_store

JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 100 + b"\xff\xd9"
FIRST_SEEN = utc_now().replace(microsecond=0)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setenv("THUMBNAIL_DIR", str(tmp_path))
    thumbnail_store.cache_clear()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        for camera in ("CAM-01", "CAM-02"):
            db.add(Device(external_id=camera, name=camera, kind="physical", status="offline", lat=11, lng=-74))
        db.commit()
        _, secret = issue(db, "CAM-01")
        db.commit()

        def get_test_db():
            yield db

        app.dependency_overrides[get_db] = get_test_db
        settings = Settings(database_url="sqlite://", cors_origins=(), ingest_api_token=None, ingest_auth_mode="device")
        with patch.object(ingest, "settings", settings):
            yield db, secret, ASGITestClient(app), tmp_path
        app.dependency_overrides.clear()
    thumbnail_store.cache_clear()
    engine.dispose()


def publish_track(client, secret, session_id, track_id=7):
    body = {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(session_id),
            "sequenceNumber": 1, "cameraId": "CAM-01", "generatedAt": FIRST_SEEN.isoformat(),
            "nodeVersion": "movil-1.4.0", "model": "yolo26n", "modelVersion": "yolo26n", "frameNumber": 1,
            "detections": [{"trackId": track_id, "vehicleType": "car", "confidence": 0.9,
                            "firstSeen": FIRST_SEEN.isoformat(), "lastSeen": FIRST_SEEN.isoformat(),
                            "direction": "indeterminada", "boundingBox": [1, 2, 30, 40], "color": "white",
                            "make": None, "model": None, "licensePlate": None}]}
    response = client.post("/api/v1/ingest/detections", json=body, headers={"X-Vigia-Device-Token": secret})
    assert response.status_code == 202


def upload(client, secret, session_id, *, track_id=7, camera="CAM-01", data=JPEG, content_type="image/jpeg"):
    params = {"cameraId": camera, "sessionId": str(session_id), "trackId": track_id, "firstSeen": FIRST_SEEN.isoformat()}
    headers = {"Content-Type": content_type}
    if secret:
        headers["X-Vigia-Device-Token"] = secret
    return client.post("/api/v1/ingest/thumbnails", params=params, content=data, headers=headers)


def test_edge_uploads_one_recorte_per_track_and_only_the_key_is_stored(setup):
    db, secret, client, root = setup
    session_id = uuid.uuid4()
    publish_track(client, secret, session_id)

    response = upload(client, secret, session_id)
    assert response.status_code == 201
    assert upload(client, secret, session_id).status_code == 201  # A retry overwrites the same object.

    detection = db.scalars(select(Detection)).one()
    key = thumbnail_key("CAM-01", session_id, 7, FIRST_SEEN)
    assert response.json()["detection_id"] == str(detection.id)
    assert detection.thumbnail_url == key
    assert (root / key).read_bytes() == JPEG
    assert len(list(root.rglob("*.jpg"))) == 1


def test_rejects_unknown_tracks_other_cameras_and_non_jpeg(setup):
    db, secret, client, _ = setup
    session_id = uuid.uuid4()
    publish_track(client, secret, session_id)

    assert upload(client, secret, session_id, track_id=99).status_code == 404
    assert upload(client, None, session_id).status_code == 401
    assert upload(client, secret, session_id, camera="CAM-02").status_code == 403
    assert upload(client, secret, session_id, content_type="image/png").status_code == 415
    assert upload(client, secret, session_id, data=b"not a jpeg").status_code == 415
    assert upload(client, secret, session_id, data=JPEG[:3] + b"\x00" * 70_000 + JPEG[-2:]).status_code == 413
    assert db.scalars(select(Detection)).one().thumbnail_url is None


def test_disabled_storage_answers_501(setup, monkeypatch):
    _, secret, client, _ = setup
    session_id = uuid.uuid4()
    publish_track(client, secret, session_id)
    monkeypatch.delenv("THUMBNAIL_DIR")
    thumbnail_store.cache_clear()
    assert upload(client, secret, session_id).status_code == 501


def test_only_admins_see_recortes_and_each_view_is_audited(setup):
    db, secret, client, _ = setup
    session_id = uuid.uuid4()
    publish_track(client, secret, session_id)
    upload(client, secret, session_id)
    detection = db.scalars(select(Detection)).one()
    url = f"/api/v1/detections/{detection.id}/thumbnail"

    assert client.get(url, headers=bearer(db, "operator")).status_code == 403
    response = client.get(url, headers=bearer(db, "admin"))

    assert response.status_code == 200
    assert response.content == JPEG
    assert response.headers["cache-control"] == "private, no-store"
    views = db.scalars(select(SecurityAudit).where(SecurityAudit.action == "thumbnail.viewed")).all()
    assert [v.detail["detection"] for v in views] == [str(detection.id)]


def test_recortes_expire_after_seven_days(setup):
    db, secret, client, root = setup
    session_id = uuid.uuid4()
    publish_track(client, secret, session_id)
    upload(client, secret, session_id)
    detection = db.scalars(select(Detection)).one()
    admin = bearer(db, "admin")

    detection.created_at = utc_now() - timedelta(days=8)
    db.commit()
    assert client.get(f"/api/v1/detections/{detection.id}/thumbnail", headers=admin).status_code == 404

    assert purge_thumbnails(db, now=utc_now() + timedelta(days=8)) == 1
    assert detection.thumbnail_url is None
    assert not list(root.rglob("*.jpg"))
