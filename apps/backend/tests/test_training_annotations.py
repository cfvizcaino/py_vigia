"""Fase 4: etiquetas explícitas de color y placa, almacén de aprendizaje y exportación."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from tests.asgi_client import ASGITestClient
from tests.auth_helpers import bearer
from vigia_backend import dataset, thumbnails
from vigia_backend.api import app
from vigia_backend.db import Base, get_db
from vigia_backend.models import Detection, Device, SecurityAudit, TrainingAnnotation, utc_now
from vigia_backend.training_export import export_dataset, split_for

JPEG = b"\xff\xd8\xff\xe0" + b"recorte" + b"\xff\xd9"


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("THUMBNAIL_DIR", str(tmp_path / "recortes"))
    monkeypatch.setenv("DATASET_DIR", str(tmp_path / "aprendizaje"))
    for name in ("THUMBNAIL_STORAGE_CONNECTION_STRING", "DATASET_STORAGE_CONNECTION_STRING"):
        monkeypatch.delenv(name, raising=False)
    thumbnails.thumbnail_store.cache_clear()
    dataset.dataset_store.cache_clear()
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    # Postgres applies ON DELETE SET NULL; SQLite only with foreign keys on.
    event.listen(engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON"))
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine, autoflush=False)()

    def override():
        yield db

    app.dependency_overrides[get_db] = override
    cam = Device(external_id="CEL-02", name="Teléfono", kind="physical", status="offline", lat=11, lng=-74)
    db.add(cam)
    db.flush()
    admin = bearer(db, "admin")
    operator = bearer(db, "operator")
    yield db, cam, ASGITestClient(app, headers=admin), ASGITestClient(app, headers=operator), tmp_path
    app.dependency_overrides.clear()
    db.close()
    thumbnails.thumbnail_store.cache_clear()
    dataset.dataset_store.cache_clear()


def _detection(db, cam, *, image: bytes | None = JPEG, color="white", plate=None, observed=None, track=1):
    det = Detection(device_id=cam.id, track_id=track, vehicle_type="car", color=color, direction="indeterminada",
                    confidence=.88, observed_at=observed or utc_now(), license_plate=plate)
    db.add(det)
    db.flush()
    if image is not None:
        key = f"CEL-02/s/{det.id}.jpg"
        thumbnails.thumbnail_store().put(key, image)
        det.thumbnail_url = key
    db.commit()
    return det


def test_admin_labels_colour_and_plate_and_the_recorte_is_copied(env):
    db, cam, admin, operator, tmp = env
    det = _detection(db, cam, plate="ABC123")

    saved = admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "gray"})
    assert saved.status_code == 200, saved.text
    assert saved.json()["label"] == "gray" and saved.json()["predicted"] == "white"
    digest = hashlib.sha256(JPEG).hexdigest()
    assert (tmp / "aprendizaje" / "color" / f"{digest}.jpg").read_bytes() == JPEG

    assert admin.put(f"/api/v1/detections/{det.id}/annotations/plate", json={"label": "abc-128"}).json()["label"] == "ABC128"
    # Correcting the same task replaces the label instead of adding a row.
    assert admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "no_determinable"}).status_code == 200
    listed = {row["task"]: row["label"] for row in admin.get(f"/api/v1/detections/{det.id}/annotations").json()}
    assert listed == {"color": "no_determinable", "plate": "ABC128"}
    assert len(db.scalars(select(TrainingAnnotation)).all()) == 2

    # The audit never stores the plate text.
    details = [row.detail for row in db.scalars(select(SecurityAudit).where(SecurityAudit.action == "annotation.saved"))]
    assert all("ABC128" not in json.dumps(detail) for detail in details)
    summary = admin.get("/api/v1/admin/annotations/summary").json()
    assert summary["counts"]["color"] == {"no_determinable": 1}
    assert summary["counts"]["plate"] == {"texto": 1}
    assert summary["corrected"] == 2


def test_invalid_labels_expired_recortes_and_operators_are_refused(env):
    db, cam, admin, operator, _ = env
    det = _detection(db, cam)
    assert admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "fucsia"}).status_code == 422
    assert admin.put(f"/api/v1/detections/{det.id}/annotations/plate", json={"label": "XX"}).status_code == 422
    assert admin.put(f"/api/v1/detections/{det.id}/annotations/marca", json={"label": "x"}).status_code == 404
    assert operator.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "red"}).status_code == 403
    without = _detection(db, cam, image=None)
    assert admin.put(f"/api/v1/detections/{without.id}/annotations/color", json={"label": "red"}).status_code == 409
    old = _detection(db, cam)
    old.created_at = utc_now() - timedelta(days=8)
    db.commit()
    assert admin.put(f"/api/v1/detections/{old.id}/annotations/color", json={"label": "red"}).status_code == 409


def test_undo_deletes_the_copy_only_when_no_other_label_uses_it(env):
    db, cam, admin, _, tmp = env
    det = _detection(db, cam)
    admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "red"})
    admin.put(f"/api/v1/detections/{det.id}/annotations/plate", json={"label": "sin_placa"})
    digest = hashlib.sha256(JPEG).hexdigest()
    assert admin.delete(f"/api/v1/detections/{det.id}/annotations/color").status_code == 204
    assert not (tmp / "aprendizaje" / "color" / f"{digest}.jpg").exists()
    assert (tmp / "aprendizaje" / "plate" / f"{digest}.jpg").exists()


def test_annotations_outlive_the_detection_and_expire_with_the_dataset_policy(env, monkeypatch):
    db, cam, admin, _, tmp = env
    det = _detection(db, cam)
    admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": "red"})
    db.delete(db.get(Detection, det.id))
    db.commit()
    row = db.scalar(select(TrainingAnnotation))
    assert row.detection_id is None and row.camera_id == "CEL-02"
    monkeypatch.setenv("DATASET_RETENTION_DAYS", "30")
    row.created_at = utc_now() - timedelta(days=31)
    db.commit()
    assert dataset.purge_annotations(db) == 1
    assert not list((tmp / "aprendizaje").rglob("*.jpg"))


def test_split_is_stable_per_camera_and_day():
    assert split_for("CEL-02|2026-11-18") == split_for("CEL-02|2026-11-18")
    shares = [split_for(f"CEL-{i:02d}|2026-11-{d:02d}") for i in range(10) for d in range(1, 29)]
    assert 0.1 < shares.count("test") / len(shares) < 0.3


def test_export_is_versioned_deduplicated_and_never_overwrites(env):
    db, cam, admin, _, tmp = env
    base = datetime(2026, 11, 10, 15, tzinfo=timezone.utc)
    ids = []
    for day in range(6):
        for n in range(2):
            image = JPEG[:-2] + f"{day}-{n}".encode() + JPEG[-2:]
            det = _detection(db, cam, image=image, observed=base + timedelta(days=day, minutes=n), track=day * 10 + n)
            ids.append(det.id)
            label = "no_determinable" if (day, n) == (0, 0) else "white" if n else "gray"
            assert admin.put(f"/api/v1/detections/{det.id}/annotations/color", json={"label": label}).status_code == 200
    # Same image, two different colours: excluded as a conflict.
    twin = _detection(db, cam, image=JPEG[:-2] + b"1-1" + JPEG[-2:], observed=base + timedelta(days=1, minutes=1), track=99)
    admin.put(f"/api/v1/detections/{twin.id}/annotations/color", json={"label": "red"})

    manifest = export_dataset(db, tmp / "export-v1", "color")
    assert manifest["excluded"] == {"etiquetas_en_conflicto": 1, "no_determinable": 1}
    exported = [s for s in manifest["samples"] if s["file"]]
    # 12 labelled images − 1 no_determinable − 1 shared by the conflicting pair.
    assert len(exported) == 10
    for sample in exported:
        assert (tmp / "export-v1" / sample["file"]).is_file()
        assert sample["file"].split("/")[:2] == [sample["split"], sample["label"]]
    # One group (camera + day) never spans two splits.
    by_group: dict[str, set[str]] = {}
    for sample in manifest["samples"]:
        by_group.setdefault(sample["group"], set()).add(sample["split"])
    assert all(len(splits) == 1 for splits in by_group.values())
    on_disk = json.loads((tmp / "export-v1" / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk["dataset_fingerprint"] == manifest["dataset_fingerprint"]
    with pytest.raises(FileExistsError):
        export_dataset(db, tmp / "export-v1", "color")

    plates = export_dataset(db, tmp / "plates-v1", "plate")
    assert plates["samples"] == [] and (tmp / "plates-v1" / "labels.jsonl").read_text() == ""
