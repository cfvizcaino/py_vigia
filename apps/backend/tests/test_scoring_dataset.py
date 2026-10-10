"""El dataset sintético es consistente y los casos de control no se degradan."""

from datetime import datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend.api import app
from vigia_backend.db import Base, get_db
from vigia_backend.models import Device
from vigia_backend.scoring_dataset import DEFAULT_PATH, evaluate, load_dataset


def test_dataset_is_internally_consistent():
    data = load_dataset(DEFAULT_PATH)
    assert data["synthetic"] is True
    cameras = {c["external_id"] for c in data["cameras"]}
    links = {(l["from"], l["to"]) for l in data["road_links"] if l["options"]}
    ids = [d["id"] for d in data["detections"]]
    assert len(ids) == len(set(ids))
    assert all(d["camera_id"] in cameras for d in data["detections"])
    for vehicle in data["vehicles"]:
        assert all((a, b) in links for a, b in zip(vehicle["path"], vehicle["path"][1:]))
        times = [d["observed_at"] for d in data["detections"] if d["vehicle_id"] == vehicle["id"]]
        assert times == sorted(times)
    for case in data["cases"]:
        assert datetime.fromisoformat(case["time_from"]) < datetime.fromisoformat(case["time_to"])


def test_control_cases_keep_their_expected_outcome():
    cases = {c["case"]: c for c in evaluate(load_dataset(DEFAULT_PATH))["cases"]}
    # A clean trip and a weak-but-coherent one must rank first.
    assert cases["S01"]["truths"][0]["rank"] == 1 and cases["S01"]["false_links_topk"] == 0
    assert cases["S08"]["truths"][0]["rank"] == 1
    # An impossible jump and pure noise must not produce any route.
    assert cases["S06"]["routes"] == 0
    assert cases["S10"]["routes"] == 0


def test_report_exposes_comparable_metrics():
    summary = evaluate(load_dataset(DEFAULT_PATH))["summary"]
    assert summary["trajectories"] > 0
    for key in ("recall_at_1", "recall_at_3", "mean_best_jaccard_top3", "false_link_rate_topk"):
        assert 0 <= summary[key] <= 1


def test_scenarios_are_listed_only_on_a_scoring_database():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        def get_test_db():
            yield db
        app.dependency_overrides[get_db] = get_test_db
        try:
            client = ASGITestClient(app, headers=bearer(db, "operator"))
            assert ASGITestClient(app).get("/api/v1/scenarios").status_code == 401
            db.add(Device(external_id="CAM-01", name="Tapo", kind="physical", status="online", lat=11, lng=-74))
            db.commit()
            assert client.get("/api/v1/scenarios").json() == []  # Pilot database: no picker.
            db.add(Device(external_id="SC-07", name="Calle 81", kind="simulated", status="simulated", lat=11.008375, lng=-74.809824))
            db.commit()
            cases = client.get("/api/v1/scenarios").json()
        finally:
            app.dependency_overrides.clear()
    assert len(cases) == 10
    assert cases[0] == {"id": "S01", "title": "Recorrido limpio", "challenge": "control", "camera_id": "SC-07",
                        "radius_m": 2500.0, "date": "2026-09-15", "time_from": "07:00", "time_to": "07:20",
                        "vehicle_type": "car", "color": "white"}
    assert cases[2]["color"] is None and cases[2]["vehicle_type"] == "motorcycle"
