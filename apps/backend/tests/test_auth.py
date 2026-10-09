"""Criterios de aceptación P0.4: personas, roles aplicados en backend y auditoría de uso."""

from datetime import datetime, timedelta, timezone
import json
import uuid

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import PASSWORD, bearer
from vigia_backend.api import app
from vigia_backend.db import Base, get_db
from vigia_backend.models import Detection, Device, SecurityAudit, User, UserSession, utc_now
from vigia_backend.users import LOCKOUT_FAILURES, create_user, hash_password, verify_password

QUERY = {"lat": 11.0131, "lng": -74.8172, "radius_m": 1000,
         "time_from": "2026-08-25T14:00:00+00:00", "time_to": "2026-08-25T15:00:00+00:00"}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        session.add(Device(external_id="CAM-01", name="Tapo", kind="physical", status="online", lat=11.0131, lng=-74.8172))
        session.commit()

        def get_test_db():
            yield session

        app.dependency_overrides[get_db] = get_test_db
        yield session
        app.dependency_overrides.clear()
    engine.dispose()


def client(headers=None):
    return ASGITestClient(app, headers=headers)


def actions(db, name):
    return db.scalars(select(SecurityAudit).where(SecurityAudit.action == name)).all()


def test_password_hash_is_salted_and_verifiable():
    first, second = hash_password(PASSWORD), hash_password(PASSWORD)
    assert first != second and PASSWORD not in first
    assert verify_password(PASSWORD, first)
    assert not verify_password(PASSWORD + "x", first)
    assert not verify_password(PASSWORD, None)
    assert not verify_password(PASSWORD, "plain")
    with pytest.raises(ValueError):
        hash_password("corta")


@pytest.mark.parametrize("method,path", [
    ("GET", "/api/v1/devices"),
    ("GET", "/api/v1/detections"),
    ("GET", "/api/v1/queries"),
    ("POST", f"/api/v1/queries/{uuid.uuid4()}/export"),
    ("POST", "/api/v1/auth/preview-access"),
    ("GET", "/api/v1/admin/audit"),
    ("GET", "/api/v1/auth/me"),
])
def test_anonymous_and_forged_tokens_are_rejected(db, method, path):
    for headers in (None, {"Authorization": "Bearer vigia_s_forged"}, {"Authorization": "Basic abc"}):
        assert client(headers).request(method, path, params=QUERY).status_code == 401
    assert not db.scalars(select(SecurityAudit)).all()  # Anonymous noise is not persisted.


def test_health_stays_public(db):
    assert client().get("/health").status_code == 200


def test_login_returns_token_once_and_stores_only_hash(db):
    create_user(db, "Ana@Vigia.test", "Ana", "operator", PASSWORD)
    db.commit()
    response = client().post("/api/v1/auth/login", json={"email": "ana@vigia.test", "password": PASSWORD})
    assert response.status_code == 200
    body = response.json()
    assert body["user"]["role"] == "operator" and "password" not in json.dumps(body)
    stored = db.scalars(select(UserSession)).one()
    assert body["token"] not in stored.token_hash
    me = client({"Authorization": f"Bearer {body['token']}"}).get("/api/v1/auth/me")
    assert me.json()["user"]["email"] == "ana@vigia.test"
    assert datetime.fromisoformat(me.json()["expires_at"]).tzinfo is not None


def test_wrong_password_and_unknown_email_give_same_answer(db):
    create_user(db, "ana@vigia.test", "Ana", "operator", PASSWORD)
    db.commit()
    wrong = client().post("/api/v1/auth/login", json={"email": "ana@vigia.test", "password": "otra-contraseña-larga"})
    unknown = client().post("/api/v1/auth/login", json={"email": "nadie@vigia.test", "password": PASSWORD})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()


def test_repeated_failures_lock_the_account_even_with_right_password(db):
    create_user(db, "ana@vigia.test", "Ana", "operator", PASSWORD)
    db.commit()
    for _ in range(LOCKOUT_FAILURES):
        assert client().post("/api/v1/auth/login", json={"email": "ana@vigia.test", "password": "incorrecta-larga"}).status_code == 401
    assert client().post("/api/v1/auth/login", json={"email": "ana@vigia.test", "password": PASSWORD}).status_code == 429
    for row in actions(db, "auth.login"):
        row.occurred_at = utc_now() - timedelta(minutes=16)
    db.commit()
    assert client().post("/api/v1/auth/login", json={"email": "ana@vigia.test", "password": PASSWORD}).status_code == 200


def test_user_without_password_hash_cannot_log_in(db):
    db.add(User(email="demo@vigia.local", display_name="Seed", role="operator"))
    db.commit()
    assert client().post("/api/v1/auth/login", json={"email": "demo@vigia.local", "password": PASSWORD}).status_code == 401


def test_logout_expiry_and_disable_end_sessions(db):
    headers = bearer(db, "operator")
    assert client(headers).post("/api/v1/auth/logout").status_code == 204
    assert client(headers).get("/api/v1/devices").status_code == 401

    expiring = bearer(db, "operator", "b@vigia.test")
    session = db.scalars(select(UserSession).where(UserSession.revoked_at.is_(None))).one()
    session.expires_at = utc_now() - timedelta(seconds=1)
    db.commit()
    assert client(expiring).get("/api/v1/devices").status_code == 401

    disabled = bearer(db, "operator", "c@vigia.test")
    db.scalar(select(User).where(User.email == "c@vigia.test")).is_active = False
    db.commit()
    assert client(disabled).get("/api/v1/devices").status_code == 401


def test_operator_reads_and_queries_but_cannot_change_anything(db):
    headers = bearer(db, "operator")
    operator = client(headers)
    device_id = db.scalar(select(Device)).id
    assert operator.get("/api/v1/devices").status_code == 200
    assert operator.get("/api/v1/queries", params=QUERY).status_code == 200
    denied = [
        operator.post("/api/v1/devices", json={"external_id": "CAM-09", "name": "x", "kind": "simulated", "status": "simulated", "lat": 11, "lng": -74}),
        operator.patch(f"/api/v1/devices/{device_id}", json={"status": "offline"}),
        operator.delete(f"/api/v1/devices/{device_id}"),
        operator.post("/api/v1/detections", json={"device_id": str(device_id), "vehicle_type": "car", "direction": "indeterminada", "confidence": 0.5, "observed_at": QUERY["time_from"]}),
        operator.post("/api/v1/admin/devices/CAM-01/credentials", json={}),
        operator.get("/api/v1/admin/audit"),
    ]
    assert [r.status_code for r in denied] == [403] * len(denied)
    assert db.get(Device, device_id).status == "online"
    assert len(actions(db, "authz.denied")) == len(denied)


def test_admin_changes_are_audited_with_actor(db):
    headers = bearer(db, "admin")
    admin = client(headers)
    admin_id = db.scalar(select(User).where(User.role == "admin")).id
    device_id = db.scalar(select(Device)).id
    assert admin.patch(f"/api/v1/devices/{device_id}", json={"status": "offline"}).status_code == 200
    row = actions(db, "device.updated")[0]
    assert row.user_id == admin_id and row.detail == {"camera": "CAM-01", "fields": ["status"]}


def test_queries_use_the_authenticated_user_and_are_audited(db):
    headers = bearer(db, "operator")
    body = client(headers).get("/api/v1/queries", params=QUERY).json()
    operator = db.scalar(select(User).where(User.email == "operator@vigia.test"))
    assert body["query"]["user_id"] == str(operator.id)
    entry = actions(db, "query.executed")[0]
    assert entry.user_id == operator.id and entry.detail["query"] == body["query"]["id"]
    assert "lat" not in entry.detail  # Coordinates stay in `queries`, not duplicated in the log.


def test_export_is_server_side_audited_and_scoped_to_owner(db):
    db.add(Detection(device_id=db.scalar(select(Device)).id, vehicle_type="car", color="white", direction="indeterminada",
                     confidence=0.9, observed_at=datetime(2026, 8, 25, 14, 30, tzinfo=timezone.utc)))
    db.commit()
    owner = bearer(db, "operator", "owner@vigia.test")
    other = bearer(db, "operator", "other@vigia.test")
    admin = bearer(db, "admin")
    query_id = client(owner).get("/api/v1/queries", params=QUERY).json()["query"]["id"]

    exported = client(owner).post(f"/api/v1/queries/{query_id}/export")
    assert exported.status_code == 200
    assert exported.json()["exported_by"] == "owner@vigia.test"
    assert "identificación confirmada" in exported.json()["notice"]
    assert client(other).post(f"/api/v1/queries/{query_id}/export").status_code == 404
    assert client(admin).post(f"/api/v1/queries/{query_id}/export").status_code == 200
    assert client(owner).post(f"/api/v1/queries/{uuid.uuid4()}/export").status_code == 404
    assert len(actions(db, "query.exported")) == 2


def test_preview_access_requires_session_and_leaves_trace(db):
    payload = {"camera_id": "CAM-01", "kind": "stream"}
    assert client().post("/api/v1/auth/preview-access", json=payload).status_code == 401
    headers = bearer(db, "operator")
    assert client(headers).post("/api/v1/auth/preview-access", json=payload).status_code == 204
    assert actions(db, "preview.accessed")[0].detail == {"camera": "CAM-01", "kind": "stream"}


def test_admin_issues_and_revokes_device_credentials_over_http(db):
    admin = client(bearer(db, "admin"))
    issued = admin.post("/api/v1/admin/devices/CAM-01/credentials", json={"days": 30})
    assert issued.status_code == 201
    secret, credential_id = issued.json()["secret"], issued.json()["id"]
    listed = admin.get("/api/v1/admin/credentials").json()
    assert listed[0]["id"] == credential_id and "secret" not in listed[0]
    assert admin.post("/api/v1/admin/devices/CAM-404/credentials", json={}).status_code == 404
    assert admin.delete(f"/api/v1/admin/credentials/{credential_id}").status_code == 204
    trail = admin.get("/api/v1/admin/audit").json()
    assert {"credential.issued", "credential.revoked"} <= {row["action"] for row in trail}
    assert all(row["user_id"] for row in trail if row["action"].startswith("credential."))
    assert secret not in json.dumps(trail)


def test_audit_filters_by_category_shows_actor_and_paginates(db):
    admin = client(bearer(db, "admin"))
    operator = client(bearer(db, "operator"))
    operator.get("/api/v1/queries", params=QUERY)
    operator.post("/api/v1/auth/preview-access", json={"camera_id": "CAM-01", "kind": "stream"})
    operator.get("/api/v1/admin/audit")  # denied, audited

    queries = admin.get("/api/v1/admin/audit", params={"category": "queries"}).json()
    assert [row["action"] for row in queries] == ["query.executed"]
    assert queries[0]["user_email"] == "operator@vigia.test"
    assert [row["action"] for row in admin.get("/api/v1/admin/audit", params={"category": "denied"}).json()] == ["authz.denied"]
    assert admin.get("/api/v1/admin/audit", params={"category": "bogus"}).status_code == 422

    everything = admin.get("/api/v1/admin/audit").json()
    older = admin.get("/api/v1/admin/audit", params={"before": everything[1]["occurred_at"]}).json()
    assert len(older) == len(everything) - 2
