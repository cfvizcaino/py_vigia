"""Versión pública de la app móvil, escrita por el mismo paso que publica el APK."""
from __future__ import annotations

import argparse
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path

VERSION = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
EMPTY = {"latest": None, "minimum": None, "apk_url": None, "sha256": None, "notes": "", "published_at": None}


def load_app_release(path: Path | None) -> dict:
    """Lee el JSON en cada petición. Si falta o está dañado, no hay aviso (no es un error)."""
    if path is None or not path.is_file():
        return dict(EMPTY)
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return dict(EMPTY)
    if not isinstance(raw, dict):
        return dict(EMPTY)
    latest = raw.get("latest")
    minimum = raw.get("minimum")
    apk_url = raw.get("apk_url")
    sha256 = raw.get("sha256")
    notes = raw.get("notes") or ""
    published_at = raw.get("published_at")
    if latest is not None and not (isinstance(latest, str) and VERSION.match(latest)):
        return dict(EMPTY)
    if minimum is not None and not (isinstance(minimum, str) and VERSION.match(minimum)):
        return dict(EMPTY)
    if apk_url is not None and not (isinstance(apk_url, str) and apk_url.startswith(("https://", "http://"))):
        return dict(EMPTY)
    if sha256 is not None and not (isinstance(sha256, str) and SHA256.match(sha256)):
        return dict(EMPTY)
    if not isinstance(notes, str) or (published_at is not None and not isinstance(published_at, str)):
        return dict(EMPTY)
    return {
        "latest": latest,
        "minimum": minimum,
        "apk_url": apk_url,
        "sha256": sha256,
        "notes": notes[:500],
        "published_at": published_at,
    }


def _previous_minimum(path: Path | None) -> str:
    if path is None or not path.is_file() or path.stat().st_size == 0:
        return "0.0.0"
    loaded = load_app_release(path)
    return loaded["minimum"] or "0.0.0"


def write_app_release(
    output: Path,
    *,
    version: str,
    sha256: str,
    url: str,
    minimum: str | None = None,
    notes: str = "",
    previous: Path | None = None,
    published_at: datetime | None = None,
) -> dict:
    """Publica latest y conserva el minimum anterior, salvo que el operador lo suba."""
    if not VERSION.match(version):
        raise ValueError("La versión debe ser X.Y.Z")
    sha256 = sha256.strip().lower()
    if not SHA256.match(sha256):
        raise ValueError("SHA-256 debe ser 64 hexadecimales")
    if not url.startswith(("https://", "http://")):
        raise ValueError("La URL del APK debe ser http(s)")
    floor = minimum or _previous_minimum(previous)
    if not VERSION.match(floor):
        raise ValueError("El mínimo debe ser X.Y.Z")
    document = {
        "latest": version,
        "minimum": floor,
        "apk_url": url,
        "sha256": sha256,
        "notes": notes.strip()[:500],
        "published_at": (published_at or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_suffix(output.suffix + ".tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(output)
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    write = commands.add_parser("write")
    write.add_argument("--version", required=True)
    write.add_argument("--sha256", required=True)
    write.add_argument("--url", required=True)
    write.add_argument("--output", type=Path, required=True)
    write.add_argument("--minimum", help="Si se omite, se conserva el mínimo ya publicado")
    write.add_argument("--previous", type=Path)
    args = parser.parse_args()
    try:
        document = write_app_release(
            args.output,
            version=args.version,
            sha256=args.sha256,
            url=args.url,
            minimum=args.minimum,
            notes=os.getenv("VIGIA_APK_NOTES", ""),
            previous=args.previous,
        )
    except ValueError as exc:
        parser.exit(1, f"No se escribió la versión: {exc}\n")
    print(json.dumps(document, ensure_ascii=False))


if __name__ == "__main__":
    main()
