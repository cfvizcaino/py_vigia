"""Aviso de actualización de la app. Público: no lleva sesión ni token de dispositivo."""
from __future__ import annotations

import os
from pathlib import Path

from fastapi import APIRouter

from ..app_release import load_app_release

router = APIRouter(prefix="/api/v1/app", tags=["app"])


@router.get("/version")
def app_version() -> dict:
    configured = os.getenv("APP_VERSION_FILE", "").strip()
    return load_app_release(Path(configured) if configured else None)
