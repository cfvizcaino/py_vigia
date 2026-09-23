"""Tests de Haversine y del endpoint GET /api/v1/queries."""

from __future__ import annotations

import unittest
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from vigia_backend.api import app
from vigia_backend.db import Base, get_db
from vigia_backend.geo import haversine_m
from vigia_backend.models import Detection, Device, DeviceLink, User


class HaversineTests(unittest.TestCase):
    def test_nearby_cameras_under_500m_road_are_hundreds_of_meters_apart(self) -> None:
        # Aprox. CAM-01 y CAM-02 del seed
        distance = haversine_m(11.0131, -74.8172, 11.0110, -74.8148)
        self.assertGreater(distance, 300)
        self.assertLess(distance, 450)


class QueryEndpointTests(unittest.TestCase):
    def setUp(self) -> None:
        engine = create_engine(
            "sqlite://",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(bind=engine)
        TestingSession = sessionmaker(bind=engine, autoflush=False, autocommit=False)
        self.db = TestingSession()

        def override_get_db():
            try:
                yield self.db
            finally:
                pass

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        self._seed_minimal()

    def tearDown(self) -> None:
        app.dependency_overrides.clear()
        self.db.close()

    def _seed_minimal(self) -> None:
        user = User(email="demo@vigia.local", display_name="Operador demo", role="operator")
        self.db.add(user)
        cam1 = Device(
            external_id="CAM-01",
            name="Tapo",
            kind="physical",
            status="online",
            lat=11.0131,
            lng=-74.8172,
            camera_model="Tapo C110",
        )
        cam2 = Device(
            external_id="CAM-02",
            name="Calle 84",
            kind="simulated",
            status="simulated",
            lat=11.0110,
            lng=-74.8148,
        )
        self.db.add_all([cam1, cam2])
        self.db.flush()
        self.db.add(DeviceLink(from_device_id=cam1.id, to_device_id=cam2.id, road_distance_m=420.0))
        self.db.add(DeviceLink(from_device_id=cam2.id, to_device_id=cam1.id, road_distance_m=420.0))
        t0 = datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc)
        self.db.add_all(
            [
                Detection(
                    device_id=cam1.id,
                    track_id=101,
                    vehicle_type="car",
                    color="white",
                    direction="izquierda-a-derecha",
                    confidence=0.94,
                    observed_at=t0,
                ),
                Detection(
                    device_id=cam2.id,
                    track_id=101,
                    vehicle_type="car",
                    color="white",
                    direction="izquierda-a-derecha",
                    confidence=0.91,
                    observed_at=t0 + timedelta(seconds=54),
                ),
            ]
        )
        self.db.commit()

    def test_get_queries_returns_ranked_routes(self) -> None:
        response = self.client.get(
            "/api/v1/queries",
            params={
                "lat": 11.012,
                "lng": -74.816,
                "radius_m": 2000,
                "time_from": "2026-08-25T14:00:00+00:00",
                "time_to": "2026-08-25T15:00:00+00:00",
                "vehicle_type": "car",
                "color": "white",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertEqual(len(body["nearby_devices"]), 2)
        self.assertEqual(body["candidate_detection_count"], 2)
        self.assertGreaterEqual(len(body["routes"]), 1)
        best = body["routes"][0]
        self.assertEqual(best["rank"], 1)
        self.assertEqual(best["camera_ids"], ["CAM-01", "CAM-02"])
        self.assertFalse(best["has_distant_gaps"])
        self.assertIn("id", body["query"])
        self.assertTrue(uuid.UUID(best["id"]))

    def test_get_queries_rejects_inverted_time_window(self) -> None:
        response = self.client.get(
            "/api/v1/queries",
            params={
                "lat": 11.012,
                "lng": -74.816,
                "time_from": "2026-08-25T16:00:00+00:00",
                "time_to": "2026-08-25T15:00:00+00:00",
            },
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
