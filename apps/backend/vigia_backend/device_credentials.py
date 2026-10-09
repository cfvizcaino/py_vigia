"""Credenciales de ingestión por cámara: CLI local y API de administradores.

La CLI requiere acceso administrativo al host/base y escribe archivos 0600.
Por HTTP solo el rol admin emite/revoca (routers/admin.py), con auditoría.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import secrets
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import SessionLocal, init_db
from .models import Device, DeviceCredential, SecurityAudit, utc_now


def token_hash(token: str) -> str:
    # SHA-256 is suitable here: secrets carry 256 random bits, not passwords.
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def issue(db: Session, camera_id: str, days: int = 90, user_id: uuid.UUID | None = None) -> tuple[DeviceCredential, str]:
    if not 1 <= days <= 365:
        raise ValueError("La vigencia debe estar entre 1 y 365 días")
    device = db.scalar(select(Device).where(Device.external_id == camera_id))
    if device is None:
        raise ValueError("Cámara no registrada")
    secret = "vigia_" + secrets.token_urlsafe(32)
    credential = DeviceCredential(device_id=device.id, token_hash=token_hash(secret), expires_at=utc_now() + timedelta(days=days))
    db.add(credential)
    db.flush()
    db.add(SecurityAudit(action="credential.issued", camera_id=camera_id, credential_id=credential.id, outcome="allowed", user_id=user_id))
    return credential, secret


def revoke(db: Session, credential_id: uuid.UUID, user_id: uuid.UUID | None = None) -> None:
    credential = db.get(DeviceCredential, credential_id)
    if credential is None:
        raise ValueError("Credencial no registrada")
    if credential.revoked_at is None:
        credential.revoked_at = utc_now()
        device = db.get(Device, credential.device_id)
        db.add(SecurityAudit(action="credential.revoked", camera_id=device.external_id if device else None, credential_id=credential.id, outcome="allowed", user_id=user_id))


def authenticate(db: Session, token: str | None, camera_id: str) -> tuple[bool, str]:
    if not token or len(token) > 256:
        return False, "invalid"
    credential = db.scalar(select(DeviceCredential).where(DeviceCredential.token_hash == token_hash(token)))
    if credential is None or credential.revoked_at is not None:
        return False, "invalid"
    expires = credential.expires_at
    if expires.tzinfo is None:  # SQLite returns naive timestamps.
        expires = expires.replace(tzinfo=timezone.utc)
    if expires <= datetime.now(timezone.utc):
        return False, "invalid"
    device = db.get(Device, credential.device_id)
    if device is None or device.external_id != camera_id:
        return False, "wrong_camera"
    return True, "allowed"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("issue")
    create.add_argument("--camera", required=True)
    create.add_argument("--days", type=int, default=90)
    create.add_argument("--output", type=Path, required=True, help="Archivo nuevo 0600; no imprime el token")
    remove = commands.add_parser("revoke")
    remove.add_argument("--id", type=uuid.UUID, required=True)
    commands.add_parser("list")
    commands.add_parser("audit")
    args = parser.parse_args()
    init_db()  # Require an explicitly migrated schema.
    try:
        with SessionLocal() as db:
            if args.command == "issue":
                credential, secret = issue(db, args.camera, args.days)
                fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                with os.fdopen(fd, "w") as target:
                    target.write(f"VIGIA_CENTRAL_API_TOKEN={secret}\n")
                db.commit()
                print(json.dumps({"credential_id": str(credential.id), "camera": args.camera, "expires_at": credential.expires_at.isoformat(), "secret_file": str(args.output)}))
            elif args.command == "revoke":
                revoke(db, args.id)
                db.commit()
                print("Credencial revocada")
            elif args.command == "list":
                rows = db.execute(select(DeviceCredential, Device.external_id).join(Device, Device.id == DeviceCredential.device_id)).all()
                print(json.dumps([{"id": str(c.id), "camera": camera, "expires_at": c.expires_at.isoformat(), "revoked": c.revoked_at is not None} for c, camera in rows], indent=2))
            else:
                rows = db.scalars(select(SecurityAudit).order_by(SecurityAudit.occurred_at.desc()).limit(100)).all()
                print(json.dumps([{"action": r.action, "camera": r.camera_id, "outcome": r.outcome, "at": r.occurred_at.isoformat()} for r in rows], indent=2))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"No se completó la operación: {exc}\n")


if __name__ == "__main__":
    main()
