"""Comportamiento sobre PostgreSQL real: migraciones, zonas horarias y reintentos concurrentes.

Se ejecuta solo con VIGIA_TEST_POSTGRES_URL apuntando a una base desechable, p. ej.:
VIGIA_TEST_POSTGRES_URL=postgresql+psycopg://vigia:...@127.0.0.1:5432/vigia_test
La prueba borra y recrea el esquema `public` de esa base.
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import os
import threading
from unittest.mock import patch
import uuid

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session, sessionmaker

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend import models  # noqa: F401
from vigia_backend.api import app
from vigia_backend.config import Settings
from vigia_backend.db import Base, get_db
from vigia_backend.device_credentials import issue
from vigia_backend.migrate import configuration, require_current, upgrade
from vigia_backend.models import Detection, Device, IngestedEvent
from vigia_backend.routers import ingest

URL = os.getenv("VIGIA_TEST_POSTGRES_URL")
pytestmark = pytest.mark.skipif(not URL, reason="Define VIGIA_TEST_POSTGRES_URL para probar contra PostgreSQL")


@pytest.fixture
def engine():
    engine = create_engine(URL, pool_pre_ping=True)
    with engine.begin() as connection:
        connection.execute(text("DROP SCHEMA public CASCADE"))
        connection.execute(text("CREATE SCHEMA public"))
    upgrade(engine)
    yield engine
    engine.dispose()


def test_migrations_match_models_and_round_trip(engine):
    require_current(engine)
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []
    with engine.begin() as connection:
        command.downgrade(configuration(connection), "base")
        assert connection.scalar(text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name <> 'alembic_version'")) == 0
    upgrade(engine)
    require_current(engine)


def test_timestamps_round_trip_as_utc_aware(engine):
    with Session(engine) as db:
        device = Device(external_id="CAM-01", name="Tapo", kind="physical", status="online", lat=11.0131, lng=-74.8172)
        db.add(device)
        db.flush()
        colombia = timezone(timedelta(hours=-5))
        db.add(Detection(device_id=device.id, vehicle_type="car", direction="indeterminada", confidence=0.9,
                         observed_at=datetime(2026, 8, 25, 9, 30, tzinfo=colombia)))
        db.commit()
        stored = db.scalar(select(Detection)).observed_at
    assert stored.utcoffset() is not None
    assert stored == datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc)


def test_concurrent_retries_of_one_event_store_it_once(engine):
    """Two retries pass the existence check together; the loser must answer `duplicate`, not 500."""
    barrier = threading.Barrier(2, timeout=10)

    class RacingSession(Session):
        waited = False

        def flush(self, objects=None):
            # Hold the first real insert until both requests passed the existence checks.
            # Postgres then blocks the loser on the unique index until the winner commits.
            if not self.waited and (self.new or self.dirty):
                self.waited = True
                barrier.wait()
            super().flush(objects)

    factory = sessionmaker(bind=engine, class_=RacingSession, expire_on_commit=False)
    with Session(engine) as setup:
        setup.add(Device(external_id="CAM-01", name="Tapo", kind="physical", status="offline", lat=11, lng=-74))
        setup.commit()
        _, secret = issue(setup, "CAM-01")
        setup.commit()

    def get_test_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    now = datetime.now(timezone.utc)
    body = {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()), "sequenceNumber": 1,
            "cameraId": "CAM-01", "generatedAt": now.isoformat(), "nodeVersion": "0.2.0", "model": "yolo26n.pt",
            "modelVersion": "yolo26n.pt", "frameNumber": 10,
            "detections": [{"trackId": 7, "vehicleType": "car", "confidence": 0.9, "direction": "indeterminada",
                            "firstSeen": now.isoformat(), "lastSeen": now.isoformat(), "boundingBox": [1, 1, 20, 20],
                            "color": "white", "make": None, "model": None, "licensePlate": None}]}
    settings = Settings(database_url=URL, cors_origins=(), ingest_api_token=None, ingest_auth_mode="device")
    app.dependency_overrides[get_db] = get_test_db
    try:
        with patch.object(ingest, "settings", settings), ThreadPoolExecutor(2) as pool:
            client = ASGITestClient(app, headers={"X-Vigia-Device-Token": secret})
            responses = list(pool.map(lambda _: client.post("/api/v1/ingest/detections", json=body), range(2)))
    finally:
        app.dependency_overrides.clear()
    assert sorted(r.status_code for r in responses) == [202, 202], [r.text for r in responses]
    assert sorted(r.json()["status"] for r in responses) == ["accepted", "duplicate"]
    with Session(engine) as db:
        assert db.scalar(select(text("count(*)")).select_from(IngestedEvent)) == 1
        assert db.scalar(select(text("count(*)")).select_from(Detection)) == 1


def test_auth_and_query_flow_on_postgres(engine):
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        db.add(Device(external_id="CAM-01", name="Tapo", kind="physical", status="online", lat=11.0131, lng=-74.8172))
        db.commit()
        headers = bearer(db, "operator")

    def get_test_db():
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = get_test_db
    try:
        operator = ASGITestClient(app, headers=headers)
        params = {"lat": 11.0131, "lng": -74.8172, "time_from": "2026-08-25T14:00:00Z", "time_to": "2026-08-25T15:00:00Z"}
        response = operator.get("/api/v1/queries", params=params)
        assert response.status_code == 200, response.text
        query_id = response.json()["query"]["id"]
        assert operator.post(f"/api/v1/queries/{query_id}/export").status_code == 200
        assert operator.get("/api/v1/auth/me").json()["expires_at"].endswith(("Z", "+00:00"))
    finally:
        app.dependency_overrides.clear()
