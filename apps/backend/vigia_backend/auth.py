"""Dependencias de autenticación de personas y autorización por rol.

El rol se aplica aquí, en el backend; la interfaz solo oculta acciones.
Los nodos edge usan credenciales de dispositivo distintas (routers/ingest.py).
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from .db import get_db
from .models import SecurityAudit, User, UserSession
from .users import resolve_session


@dataclass(frozen=True)
class Principal:
    user: User
    session: UserSession


# Declared as a security scheme so /docs offers a single "Authorize" button.
# auto_error=False: a missing or non-Bearer header falls through to our own 401 below.
bearer_scheme = HTTPBearer(auto_error=False, description="Token devuelto por POST /api/v1/auth/login")


def current_principal(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Principal:
    resolved = resolve_session(db, credentials.credentials if credentials else None)
    if resolved is None:
        # Anonymous rejections are not persisted: they would let anyone fill the audit table.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return Principal(*resolved)


def require_role(*roles: str):
    def dependency(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> Principal:
        if principal.user.role not in roles:
            audit(db, principal, "authz.denied", outcome="forbidden", detail={"required": list(roles)})
            db.commit()
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient role")
        return principal

    return dependency


# Lectura y consultas: cualquier persona autenticada. Cambios y credenciales: solo admin.
require_operator = require_role("operator", "admin")
require_admin = require_role("admin")


def audit(db: Session, principal: Principal | None, action: str, outcome: str = "allowed", detail: dict | None = None) -> None:
    """Agrega un registro a la sesión del llamador; se persiste con su commit."""
    db.add(SecurityAudit(action=action, user_id=principal.user.id if principal else None, outcome=outcome, detail=detail))
