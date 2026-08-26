"""Pruebas de integración del CRUD devices/detections."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from vigia_backend.api import app
from vigia_backend.db import Base, get_db


class DevicesDetectionsCrudTests(unittest.TestCase):
    def setUp(self) -> None:
        # SQLite en memoria: no toca el archivo local ni requiere Postgres.
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)

        def override_get_db():
            db = TestingSession()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)

    def tearDown(self) -> None:
        app.dependency_overrides.clear()

    def test_device_and_detection_crud(self) -> None:
        create_device = self.client.post(
            "/api/v1/devices",
            json={
                "external_id": "CAM-01",
                "name": "Tapo C110",
                "kind": "physical",
                "status": "online",
                "lat": 11.0131,
                "lng": -74.8172,
                "camera_model": "Tapo C110",
            },
        )
        self.assertEqual(create_device.status_code, 201)
        device_id = create_device.json()["id"]

        listed = self.client.get("/api/v1/devices")
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(len(listed.json()), 1)

        create_detection = self.client.post(
            "/api/v1/detections",
            json={
                "device_id": device_id,
                "track_id": 7,
                "vehicle_type": "car",
                "color": "white",
                "direction": "izquierda-a-derecha",
                "confidence": 0.91,
                "observed_at": datetime(2026, 8, 25, 19, 32, 8, tzinfo=timezone.utc).isoformat(),
                "thumbnail_url": None,
            },
        )
        self.assertEqual(create_detection.status_code, 201)
        body = create_detection.json()
        self.assertIsNone(body["thumbnail_url"])
        detection_id = body["id"]

        filtered = self.client.get("/api/v1/detections", params={"vehicle_type": "car", "color": "white"})
        self.assertEqual(filtered.status_code, 200)
        self.assertEqual(len(filtered.json()), 1)

        patched = self.client.patch(f"/api/v1/detections/{detection_id}", json={"color": "silver"})
        self.assertEqual(patched.status_code, 200)
        self.assertEqual(patched.json()["color"], "silver")

        deleted = self.client.delete(f"/api/v1/devices/{device_id}")
        self.assertEqual(deleted.status_code, 204)
        # CASCADE: al borrar el dispositivo desaparecen sus detecciones.
        self.assertEqual(self.client.get("/api/v1/detections").json(), [])

    def test_create_detection_requires_existing_device(self) -> None:
        response = self.client.post(
            "/api/v1/detections",
            json={
                "device_id": str(uuid.uuid4()),
                "vehicle_type": "motorcycle",
                "color": "black",
                "direction": "indeterminada",
                "confidence": 0.5,
                "observed_at": datetime(2026, 8, 25, 12, 0, tzinfo=timezone.utc).isoformat(),
            },
        )
        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
