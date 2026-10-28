"""Recortes de vehículos para que un admin confirme a mano las detecciones de una ruta.

El edge sube un JPEG pequeño por track (solo la caja del vehículo, nunca la escena). El
backend lo guarda en un contenedor privado y en `detections.thumbnail_url` queda solo la
clave del objeto, no una URL pública: cada vista pasa por la API, que exige admin y la
audita. Los recortes viven 7 días (Ley 1581: lo mínimo para revisar una consulta); la
regla de ciclo de vida del contenedor los borra y la retención del backend olvida la clave.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Protocol

from sqlalchemy import update

from .models import Detection, utc_now

MAX_BYTES = 64 * 1024
DEFAULT_RETENTION_DAYS = 7
_CAMERA = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


class ThumbnailStore(Protocol):
    def put(self, key: str, data: bytes) -> None: ...

    def get(self, key: str) -> bytes | None: ...

    def purge(self, older_than: datetime) -> None: ...


class AzureBlobStore:
    """Contenedor privado de Azure Blob; la regla de ciclo de vida borra a los 7 días."""

    def __init__(self, connection_string: str, container: str) -> None:
        from azure.storage.blob import BlobServiceClient  # Only loaded when thumbnails are on.

        self._container = BlobServiceClient.from_connection_string(connection_string).get_container_client(container)

    def put(self, key: str, data: bytes) -> None:
        from azure.storage.blob import ContentSettings

        self._container.upload_blob(key, data, overwrite=True, content_settings=ContentSettings(content_type="image/jpeg"))

    def get(self, key: str) -> bytes | None:
        from azure.core.exceptions import ResourceNotFoundError

        try:
            return self._container.download_blob(key).readall()
        except ResourceNotFoundError:
            return None

    def purge(self, older_than: datetime) -> None:
        # The container's lifecycle rule deletes blobs; listing them here every hour would
        # cost one request per recorte.
        pass


class DirectoryStore:
    """Carpeta local para desarrollo y pruebas."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def _path(self, key: str) -> Path:
        return self.root / key

    def put(self, key: str, data: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)

    def get(self, key: str) -> bytes | None:
        path = self._path(key)
        return path.read_bytes() if path.is_file() else None

    def purge(self, older_than: datetime) -> None:
        cutoff = older_than.timestamp()
        for path in self.root.rglob("*.jpg"):
            if path.stat().st_mtime < cutoff:
                path.unlink(missing_ok=True)


@lru_cache(maxsize=1)
def thumbnail_store() -> ThumbnailStore | None:
    """None si no hay almacén configurado: el backend rechaza los recortes con 503."""
    connection = os.getenv("THUMBNAIL_STORAGE_CONNECTION_STRING", "").strip()
    if connection:
        return AzureBlobStore(connection, os.getenv("THUMBNAIL_CONTAINER", "recortes").strip() or "recortes")
    directory = os.getenv("THUMBNAIL_DIR", "").strip()
    return DirectoryStore(Path(directory)) if directory else None


def retention_days() -> int:
    days = int(os.getenv("THUMBNAIL_RETENTION_DAYS", str(DEFAULT_RETENTION_DAYS)))
    if days < 1:
        raise ValueError("THUMBNAIL_RETENTION_DAYS debe ser al menos 1")
    return days


def thumbnail_key(camera_id: str, session_id: uuid.UUID, track_id: int, first_seen: datetime) -> str:
    """Una clave por track: un reintento sobrescribe el mismo objeto."""
    if not _CAMERA.match(camera_id):
        raise ValueError("cameraId no apto para una clave de objeto")
    if first_seen.tzinfo is None:
        first_seen = first_seen.replace(tzinfo=timezone.utc)
    millis = int(first_seen.timestamp() * 1000)
    return f"{camera_id}/{session_id}/{track_id}-{millis}.jpg"


def looks_like_jpeg(data: bytes) -> bool:
    return data[:3] == b"\xff\xd8\xff" and data[-2:] == b"\xff\xd9"


def is_expired(detection: Detection, *, now: datetime | None = None) -> bool:
    created = detection.created_at
    if created.tzinfo is None:  # SQLite returns naive timestamps.
        created = created.replace(tzinfo=timezone.utc)
    return created < (now or utc_now()) - timedelta(days=retention_days())


def purge_thumbnails(db, *, now: datetime | None = None) -> int:
    """Olvida las claves vencidas; el objeto ya lo borró (o lo borrará) el almacén."""
    cutoff = (now or utc_now()) - timedelta(days=retention_days())
    result = db.execute(
        update(Detection)
        .where(Detection.thumbnail_url.is_not(None), Detection.created_at < cutoff)
        .values(thumbnail_url=None)
        .execution_options(synchronize_session="fetch")
    )
    db.commit()
    store = thumbnail_store()
    if store is not None:
        store.purge(cutoff)
    return result.rowcount or 0
