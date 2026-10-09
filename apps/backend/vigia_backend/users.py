"""Personas: contraseñas, sesiones revocables y CLI local de administración.

Las altas se hacen solo por CLI con acceso al host/base. La contraseña nunca se
recibe como argumento (quedaría en el historial): se pide por terminal o stdin.
"""
from __future__ import annotations

import argparse
import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import getpass
import hashlib
import hmac
import json
import secrets
import sys

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from .device_credentials import token_hash
from .models import SecurityAudit, User, UserSession, utc_now

ROLES = ("operator", "admin")
MIN_PASSWORD_LENGTH = 12
MAX_PASSWORD_LENGTH = 256
LOCKOUT_FAILURES = 5
LOCKOUT_WINDOW = timedelta(minutes=15)
# scrypt (stdlib): memoria ~32 MiB por verificación; parámetros guardados en el hash.
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**15, 8, 1
_SCRYPT_MAXMEM = 64 * 1024 * 1024


def _b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode("ascii")


def _scrypt(password: str, salt: bytes, n: int, r: int, p: int) -> bytes:
    return hashlib.scrypt(password.encode("utf-8"), salt=salt, n=n, r=r, p=p, maxmem=_SCRYPT_MAXMEM, dklen=32)


def validate_password(password: str) -> None:
    if not MIN_PASSWORD_LENGTH <= len(password) <= MAX_PASSWORD_LENGTH:
        raise ValueError(f"La contraseña debe tener entre {MIN_PASSWORD_LENGTH} y {MAX_PASSWORD_LENGTH} caracteres")


def hash_password(password: str) -> str:
    validate_password(password)
    salt = secrets.token_bytes(16)
    digest = _scrypt(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, encoded: str | None) -> bool:
    try:
        scheme, n, r, p, salt, digest = (encoded or "").split("$")
        if scheme != "scrypt" or len(password) > MAX_PASSWORD_LENGTH:
            return False
        candidate = _scrypt(password, base64.b64decode(salt), int(n), int(r), int(p))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(candidate, base64.b64decode(digest))


# Equalizes login time for unknown emails so they cannot be enumerated by latency.
_DUMMY_HASH = f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(b'0' * 16)}${_b64(b'0' * 32)}"


def as_utc(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)  # SQLite drops tz.


def normalize_email(email: str) -> str:
    return email.strip().lower()


def create_user(db: Session, email: str, display_name: str, role: str, password: str) -> User:
    if role not in ROLES:
        raise ValueError(f"Rol no válido; usa {' o '.join(ROLES)}")
    email = normalize_email(email)
    if "@" not in email or not display_name.strip():
        raise ValueError("Correo o nombre no válidos")
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise ValueError("Ya existe un usuario con ese correo")
    user = User(email=email, display_name=display_name.strip(), role=role, password_hash=hash_password(password))
    db.add(user)
    db.flush()
    db.add(SecurityAudit(action="user.created", user_id=user.id, outcome="allowed", detail={"role": role, "via": "cli"}))
    return user


def revoke_sessions(db: Session, user_id) -> int:
    result = db.execute(
        update(UserSession)
        .where(UserSession.user_id == user_id, UserSession.revoked_at.is_(None))
        .values(revoked_at=utc_now())
    )
    return result.rowcount or 0


@dataclass(frozen=True)
class LoginResult:
    outcome: str  # allowed | invalid | locked
    user: User | None = None
    session: UserSession | None = None
    token: str | None = None


def _recent_failures(db: Session, user_id) -> int:
    since = utc_now() - LOCKOUT_WINDOW
    last_success = db.scalar(
        select(func.max(SecurityAudit.occurred_at)).where(
            SecurityAudit.user_id == user_id, SecurityAudit.action == "auth.login", SecurityAudit.outcome == "allowed"
        )
    )
    if last_success is not None and as_utc(last_success) > since:
        since = as_utc(last_success)
    return db.scalar(
        select(func.count()).select_from(SecurityAudit).where(
            SecurityAudit.user_id == user_id,
            SecurityAudit.action == "auth.login",
            SecurityAudit.outcome == "invalid",
            SecurityAudit.occurred_at > since,
        )
    ) or 0


def login(db: Session, email: str, password: str, hours: int) -> LoginResult:
    """Valida credenciales y abre sesión. El llamador hace commit (también en fallos: auditoría)."""
    user = db.scalar(select(User).where(User.email == normalize_email(email)))
    if user is None:
        verify_password(password, _DUMMY_HASH)
        return LoginResult("invalid")
    if _recent_failures(db, user.id) >= LOCKOUT_FAILURES:
        db.add(SecurityAudit(action="auth.login", user_id=user.id, outcome="locked"))
        return LoginResult("locked")
    if not user.is_active or not verify_password(password, user.password_hash):
        db.add(SecurityAudit(action="auth.login", user_id=user.id, outcome="invalid"))
        return LoginResult("invalid")
    token = "vigia_s_" + secrets.token_urlsafe(32)
    session = UserSession(user_id=user.id, token_hash=token_hash(token), expires_at=utc_now() + timedelta(hours=hours))
    db.add(session)
    db.add(SecurityAudit(action="auth.login", user_id=user.id, outcome="allowed"))
    return LoginResult("allowed", user, session, token)


def resolve_session(db: Session, token: str | None) -> tuple[User, UserSession] | None:
    if not token or len(token) > 256:
        return None
    session = db.scalar(select(UserSession).where(UserSession.token_hash == token_hash(token)))
    if session is None or session.revoked_at is not None or as_utc(session.expires_at) <= utc_now():
        return None
    user = db.get(User, session.user_id)
    if user is None or not user.is_active or user.role not in ROLES:
        return None
    return user, session


def _read_password(from_stdin: bool) -> str:
    if from_stdin:
        return sys.stdin.readline().rstrip("\n")
    first = getpass.getpass("Contraseña: ")
    if first != getpass.getpass("Repite la contraseña: "):
        raise ValueError("Las contraseñas no coinciden")
    return first


def main() -> None:
    from .db import SessionLocal, init_db

    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create")
    create.add_argument("--email", required=True)
    create.add_argument("--name", required=True)
    create.add_argument("--role", choices=ROLES, default="operator")
    create.add_argument("--password-stdin", action="store_true", help="Lee una línea de stdin en vez de preguntar")
    reset = commands.add_parser("set-password")
    reset.add_argument("--email", required=True)
    reset.add_argument("--password-stdin", action="store_true")
    for name in ("disable", "enable"):
        commands.add_parser(name).add_argument("--email", required=True)
    commands.add_parser("list")
    args = parser.parse_args()
    init_db()  # Require an explicitly migrated schema.
    try:
        with SessionLocal() as db:
            if args.command == "list":
                users = db.scalars(select(User).order_by(User.email)).all()
                print(json.dumps([{"email": u.email, "role": u.role, "active": u.is_active, "can_login": u.password_hash is not None} for u in users], indent=2))
                return
            if args.command == "create":
                user = create_user(db, args.email, args.name, args.role, _read_password(args.password_stdin))
                db.commit()
                print(json.dumps({"id": str(user.id), "email": user.email, "role": user.role}))
                return
            user = db.scalar(select(User).where(User.email == normalize_email(args.email)))
            if user is None:
                raise ValueError("Usuario no registrado")
            if args.command == "set-password":
                user.password_hash = hash_password(_read_password(args.password_stdin))
                revoke_sessions(db, user.id)
            else:
                user.is_active = args.command == "enable"
                if not user.is_active:
                    revoke_sessions(db, user.id)
            db.add(SecurityAudit(action=f"user.{args.command}", user_id=user.id, outcome="allowed", detail={"via": "cli"}))
            db.commit()
            print("Operación completada; sesiones abiertas revocadas" if args.command != "enable" else "Usuario habilitado")
    except ValueError as exc:
        parser.exit(1, f"No se completó la operación: {exc}\n")


if __name__ == "__main__":
    main()
