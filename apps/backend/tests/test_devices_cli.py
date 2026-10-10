"""Registro de cámaras edge por CLI: validación, auditoría y token posterior."""

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from vigia_backend.db import Base
from vigia_backend.device_credentials import authenticate, issue
from vigia_backend.devices import register, relocate
from vigia_backend.models import Device, SecurityAudit


@pytest.fixture
def db():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session


def test_registered_phone_starts_offline_and_can_receive_its_own_token(db):
    register(db, "CEL-01", "Teléfono 1", 11.0131, -74.8172, "OPPO CPH2599")
    db.commit()
    device = db.scalar(select(Device))
    assert (device.kind, device.status, device.camera_model) == ("physical", "offline", "OPPO CPH2599")
    _, secret = issue(db, "CEL-01")
    db.commit()
    assert authenticate(db, secret, "CEL-01") == (True, "allowed")
    assert authenticate(db, secret, "CAM-01") == (False, "wrong_camera")
    assert [a.action for a in db.scalars(select(SecurityAudit))] == ["device.created", "credential.issued"]


@pytest.mark.parametrize("camera,lat,lng", [("cel-01", 11, -74), ("CEL 01", 11, -74), ("CEL-01", 91, -74), ("CEL-01", 11, -181)])
def test_invalid_identifiers_and_coordinates_are_rejected(db, camera, lat, lng):
    with pytest.raises(ValueError):
        register(db, camera, "x", lat, lng, None)


def test_duplicates_are_rejected_and_relocation_is_audited(db):
    register(db, "CEL-01", "Teléfono 1", 11.0, -74.8, None)
    db.commit()
    with pytest.raises(ValueError):
        register(db, "CEL-01", "Otro", 11.0, -74.8, None)
    relocate(db, "CEL-01", 11.01, -74.81)
    db.commit()
    assert (db.scalar(select(Device)).lat, db.scalar(select(Device)).lng) == (11.01, -74.81)
    assert db.scalars(select(SecurityAudit).where(SecurityAudit.action == "device.updated")).one().detail["fields"] == ["lat", "lng"]
