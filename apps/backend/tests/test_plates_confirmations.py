"""Placas (7 días, solo admin), confirmaciones de recortes y top-k diversificado."""

from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend.api import app
from vigia_backend.db import Base, get_db
from vigia_backend.ingestion import ingest_detection_envelope
from vigia_backend.models import Detection, DetectionConfirmation, Device, DeviceLink, Query, SecurityAudit, utc_now
from vigia_backend.plates import mask_plate, normalize_plate, purge_plates
from vigia_backend.routing import DetectionPoint, RoutingConfig, reconstruct_routes
from vigia_backend.schemas import DetectionEnvelopeV11

T0 = datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc)
WINDOW = {"lat": 11.012, "lng": -74.816, "radius_m": 3000,
          "time_from": "2026-08-25T14:00:00+00:00", "time_to": "2026-08-25T15:00:00+00:00", "vehicle_type": "car", "color": "white"}


def test_plate_normalization_and_mask():
    assert normalize_plate("abc-123") == "ABC123"
    assert normalize_plate(" xyz 12d ") == "XYZ12D"
    assert normalize_plate("AB1234") is None
    assert normalize_plate("") is None
    assert mask_plate("ABC123") == "ABC•••"


@pytest.fixture
def env():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False)()

    def override():
        yield db

    app.dependency_overrides[get_db] = override
    cams = [Device(external_id=f"CAM-0{i}", name=f"Cámara {i}", kind="simulated", status="simulated", lat=11.012 + i * .002, lng=-74.816)
            for i in (1, 2, 3)]
    db.add_all(cams)
    db.flush()
    for a, b in ((0, 1), (1, 2), (0, 2)):
        db.add(DeviceLink(from_device_id=cams[a].id, to_device_id=cams[b].id, road_distance_m=600.0 if b - a == 1 else 1200.0))
    db.commit()
    yield db, cams, ASGITestClient(app)
    app.dependency_overrides.clear()
    db.close()


def _detection(db, cam, seconds, plate=None, track=1):
    det = Detection(device_id=cam.id, track_id=track, vehicle_type="car", color="white", direction="indeterminada",
                    confidence=.9, observed_at=T0 + timedelta(seconds=seconds), license_plate=plate)
    db.add(det)
    db.flush()
    return det


def _two_white_cars(db, cams):
    """Two white cars cross the same three cameras 20 s apart; only plates tell them apart."""
    a = [_detection(db, cams[0], 0, "ABC123"), _detection(db, cams[1], 70, None), _detection(db, cams[2], 140, "ABC123")]
    b = [_detection(db, cams[0], 20, "XYZ987"), _detection(db, cams[1], 90, None), _detection(db, cams[2], 160, "XYZ987")]
    db.commit()
    return a, b


def test_ingestion_keeps_a_known_plate_and_ignores_malformed_text(env):
    db, cams, _ = env
    session = uuid.uuid4()

    def envelope(seq, plate):
        return DetectionEnvelopeV11.model_validate({
            "schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(session), "sequenceNumber": seq,
            "cameraId": "CAM-01", "generatedAt": T0.isoformat(), "nodeVersion": "vision-1", "model": "yolo", "modelVersion": "1",
            "frameNumber": seq, "detections": [{"trackId": 4, "vehicleType": "car", "confidence": .9, "firstSeen": T0.isoformat(),
                                                "lastSeen": (T0 + timedelta(seconds=seq)).isoformat(), "direction": "indeterminada",
                                                "boundingBox": [0, 0, 10, 10], "color": "white", "make": None, "model": None,
                                                "licensePlate": plate}]})

    ingest_detection_envelope(db, envelope(1, "no-es-placa"))
    assert db.scalars(select(Detection)).one().license_plate is None
    ingest_detection_envelope(db, envelope(2, "abc 123"))
    ingest_detection_envelope(db, envelope(3, None))
    assert db.scalars(select(Detection)).one().license_plate == "ABC123"


def test_plates_and_plate_queries_expire_after_seven_days(env):
    db, cams, _ = env
    det = _detection(db, cams[0], 0, "ABC123")
    query = Query(user_id=uuid.uuid4(), lat=11, lng=-74, radius_m=100, time_from=T0, time_to=T0, license_plate="ABC123")
    db.add(query)
    db.commit()
    assert purge_plates(db, now=utc_now() + timedelta(days=6)) == 0
    assert purge_plates(db, now=utc_now() + timedelta(days=8)) == 1
    db.refresh(det)
    db.refresh(query)
    assert det.license_plate is None and query.license_plate is None
    assert det.color == "white"  # Only the plate goes; the observation stays.


def test_only_admins_search_by_plate_and_see_plates(env):
    db, cams, client = env
    _two_white_cars(db, cams)
    operator, admin = bearer(db, "operator"), bearer(db, "admin")

    denied = client.get("/api/v1/queries", headers=operator, params={**WINDOW, "plate": "ABC123"})
    assert denied.status_code == 403
    assert db.scalars(select(SecurityAudit).where(SecurityAudit.action == "query.plate")).one().outcome == "forbidden"

    plain = client.get("/api/v1/queries", headers=operator, params=WINDOW).json()
    assert all(hop["license_plate"] is None for route in plain["routes"] for hop in route["detections"])

    assert client.get("/api/v1/queries", headers=admin, params={**WINDOW, "plate": "AB-12"}).status_code == 400
    body = client.get("/api/v1/queries", headers=admin, params={**WINDOW, "plate": "abc-123"}).json()
    best = body["routes"][0]
    assert [hop["license_plate"] for hop in best["detections"]] == ["ABC123", None, "ABC123"]
    assert all("XYZ987" != hop["license_plate"] for route in body["routes"] for hop in route["detections"])
    audit = db.scalars(select(SecurityAudit).where(SecurityAudit.action == "query.executed")).all()[-1]
    assert audit.detail["plate"] == "ABC•••"


def test_admin_confirmation_recalculates_the_routes(env):
    db, cams, client = env
    a, b = _two_white_cars(db, cams)
    # Without plates the middle step is ambiguous.
    for det in a + b:
        det.license_plate = None
    db.commit()
    admin, operator = bearer(db, "admin"), bearer(db, "operator")
    first = client.get("/api/v1/queries", headers=admin, params=WINDOW).json()
    query_id = first["query"]["id"]
    path = f"/api/v1/queries/{query_id}/confirmations"

    assert client.put(f"{path}/{a[1].id}", headers=operator, json={"verdict": "match"}).status_code == 403

    rejected = client.put(f"{path}/{b[1].id}", headers=admin, json={"verdict": "reject"})
    assert rejected.status_code == 200, rejected.text
    routes = rejected.json()["routes"]
    assert all(str(b[1].id) != hop["detection_id"] for route in routes for hop in route["detections"])

    matched = client.put(f"{path}/{a[0].id}", headers=admin, json={"verdict": "match"}).json()
    assert matched["routes"] and all(str(a[0].id) in {hop["detection_id"] for hop in route["detections"]} for route in matched["routes"])
    assert {hop["confirmation"] for hop in matched["routes"][0]["detections"] if hop["detection_id"] == str(a[0].id)} == {"match"}
    assert len(db.scalars(select(DetectionConfirmation)).all()) == 2

    undone = client.delete(f"{path}/{b[1].id}", headers=admin)
    assert undone.status_code == 200
    assert any(str(b[1].id) == hop["detection_id"] for route in undone.json()["routes"] for hop in route["detections"])
    actions = {row.action for row in db.scalars(select(SecurityAudit)).all()}
    assert {"detection.confirmed", "detection.unconfirmed"} <= actions
    # The export follows the recalculated routes.
    exported = client.post(f"/api/v1/queries/{query_id}/export", headers=admin).json()
    assert len(exported["routes"]) == len(undone.json()["routes"])


def _point(id_, camera, seconds, plate=None):
    return DetectionPoint(id_, camera, "car", "white", "indeterminada", .9, T0 + timedelta(seconds=seconds), plate)


LINKS = {("CAM-01", "CAM-02"): 600.0, ("CAM-02", "CAM-03"): 600.0, ("CAM-01", "CAM-03"): 1200.0}


def test_different_plates_never_share_a_route_and_a_plate_query_needs_the_plate():
    points = [_point("a1", "CAM-01", 0, "ABC123"), _point("b2", "CAM-02", 75, "XYZ987"), _point("a3", "CAM-03", 140, "ABC123")]
    routes = reconstruct_routes(points, LINKS, color="white")
    assert all({"a1", "b2"} > set(r.detection_ids) or not {"a1", "b2"} <= set(r.detection_ids) for r in routes)
    assert reconstruct_routes(points, LINKS, plate="ABC123")[0].detection_ids == ("a1", "a3")
    assert all("ABC123" in {p.plate for p in points if p.id in r.detection_ids} for r in reconstruct_routes(points, LINKS, plate="ABC123"))


def test_top_k_lists_different_vehicles_before_alternatives():
    # Two cars on the same cameras: the selection should show both before mixing them.
    points = [_point("a1", "CAM-01", 0), _point("a2", "CAM-02", 72), _point("a3", "CAM-03", 144),
              _point("b1", "CAM-01", 30), _point("b2", "CAM-02", 101), _point("b3", "CAM-03", 175)]
    routes = reconstruct_routes(points, LINKS, color="white", config=RoutingConfig(max_candidates=4))
    first_two = [set(r.detection_ids) for r in routes[:2]]
    assert first_two[0].isdisjoint(first_two[1])
    assert routes[0].explanation["shares_with_rank"] is None
    assert all(r.explanation["selection"] == "diversified-v1" for r in routes)
    alternatives = [r for r in routes[2:] if r.explanation["shares_with_rank"]]
    assert alternatives, "the remaining slots hold alternatives that say which route they overlap"
