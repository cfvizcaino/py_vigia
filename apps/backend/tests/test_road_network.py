import httpx
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from vigia_backend.db import Base
from vigia_backend.models import Device, DeviceLink
from vigia_backend.road_network import fetch_options, sync_links
from vigia_backend.query_service import load_road_links_m

@pytest.fixture
def cameras():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        a = Device(external_id="A", name="A", kind="simulated", status="online", lat=11, lng=-74.8)
        b = Device(external_id="B", name="B", kind="simulated", status="online", lat=11.001, lng=-74.801)
        db.add_all([a, b])
        db.commit()
        yield db, [a, b]

def response(request):
    assert request.url.params["alternatives"] == "3"
    return httpx.Response(200, json={"code": "Ok", "routes": [{"distance": 400, "duration": 50, "weight": 55,
        "weight_name": "routability", "geometry": {"coordinates": [[-74.8, 11], [-74.801, 11.001]]}}]})

def test_sync_directed_pairs_and_coordinate_invalidation(cameras):
    db, devices = cameras
    with httpx.Client(base_url="http://osrm", transport=httpx.MockTransport(response)) as client:
        result = sync_links(db, client, devices)
    assert result == {"directed_pairs": 2, "alternatives": 2}
    links = load_road_links_m(db, {d.id for d in devices})
    assert links[("A", "B")][0].duration_s == 50
    devices[0].lat = 12
    db.commit()
    assert load_road_links_m(db, {d.id for d in devices})[("A", "B")] == []

def test_network_failure_does_not_partially_update(cameras):
    db, devices = cameras
    calls = []
    def fail_second(request):
        calls.append(request)
        return response(request) if len(calls) == 1 else httpx.Response(503, json={"code": "Unavailable"})
    with httpx.Client(base_url="http://osrm", transport=httpx.MockTransport(fail_second)) as client:
        with pytest.raises(httpx.HTTPError):
            sync_links(db, client, devices)
    assert list(db.scalars(select(DeviceLink))) == []

@pytest.mark.parametrize("status", [200, 400])
def test_no_route_is_explicit_and_not_a_reverse_fallback(cameras, status):
    db, devices = cameras
    with httpx.Client(base_url="http://osrm", transport=httpx.MockTransport(lambda r: httpx.Response(status, json={"code": "NoRoute"}))) as client:
        sync_links(db, client, devices)
    assert load_road_links_m(db, {d.id for d in devices}) == {("A", "B"): [], ("B", "A"): []}

def test_malformed_geometry_rejected(cameras):
    _, devices = cameras
    def invalid(request):
        body = response(request).json()
        body["routes"][0]["geometry"]["coordinates"][0] = [999, 11]
        return httpx.Response(200, json=body)
    with httpx.Client(base_url="http://osrm", transport=httpx.MockTransport(invalid)) as client:
        with pytest.raises(ValueError, match="Coordenada"):
            fetch_options(client, *devices)
