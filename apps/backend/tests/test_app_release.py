"""La versión de la app es pública y la escribe el mismo paso que publica el APK."""
import json
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI

from tests.asgi_client import ASGITestClient
from vigia_backend.app_release import load_app_release, write_app_release
from vigia_backend.routers.app_release import router

SHA = "a" * 64


def test_missing_or_corrupt_file_advertises_nothing(tmp_path):
    assert load_app_release(None)["latest"] is None
    assert load_app_release(tmp_path / "no.json")["latest"] is None
    broken = tmp_path / "broken.json"
    broken.write_text("{", encoding="utf-8")
    assert load_app_release(broken) == {
        "latest": None, "minimum": None, "apk_url": None, "sha256": None, "notes": "", "published_at": None,
    }


def test_write_keeps_previous_minimum_unless_one_is_given(tmp_path):
    first = write_app_release(
        tmp_path / "app-version.json", version="1.2.0", sha256=SHA,
        url="https://vigia.example/descargas/vigia-1.2.0.apk", notes="arranque",
        published_at=datetime(2026, 10, 12, tzinfo=timezone.utc),
    )
    assert first["minimum"] == "0.0.0"
    second = write_app_release(
        tmp_path / "app-version.json", version="1.3.0", sha256="b" * 64,
        url="https://vigia.example/descargas/vigia-1.3.0.apk", previous=tmp_path / "app-version.json",
    )
    assert (second["latest"], second["minimum"]) == ("1.3.0", "0.0.0")
    forced = write_app_release(
        tmp_path / "app-version.json", version="1.3.0", sha256="b" * 64,
        url="https://vigia.example/descargas/vigia-1.3.0.apk", minimum="1.3.0",
    )
    assert forced["minimum"] == "1.3.0"
    assert load_app_release(tmp_path / "app-version.json")["sha256"] == "b" * 64


@pytest.mark.parametrize("kwargs", [
    {"version": "1.2", "sha256": SHA, "url": "https://vigia.example/a.apk"},
    {"version": "1.2.0", "sha256": "zz", "url": "https://vigia.example/a.apk"},
    {"version": "1.2.0", "sha256": SHA, "url": "ftp://vigia.example/a.apk"},
])
def test_rejects_a_release_the_app_could_not_check(tmp_path, kwargs):
    with pytest.raises(ValueError):
        write_app_release(tmp_path / "app-version.json", **kwargs)


def test_version_endpoint_is_public(tmp_path, monkeypatch):
    path = tmp_path / "app-version.json"
    path.write_text(json.dumps({
        "latest": "1.3.0", "minimum": "1.2.0",
        "apk_url": "https://vigia.example/descargas/vigia-1.3.0.apk",
        "sha256": SHA, "notes": "contrato", "published_at": "2026-10-12T00:00:00Z",
    }), encoding="utf-8")
    monkeypatch.setenv("APP_VERSION_FILE", str(path))
    app = FastAPI()
    app.include_router(router)
    body = ASGITestClient(app).get("/api/v1/app/version").json()
    assert body["latest"] == "1.3.0"
    assert body["minimum"] == "1.2.0"
    assert body["notes"] == "contrato"
