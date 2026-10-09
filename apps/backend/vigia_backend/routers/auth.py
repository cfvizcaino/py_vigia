"""Inicio/cierre de sesión de personas y autorización auditada de previews."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..auth import Principal, audit, current_principal, require_operator
from ..config import Settings
from ..db import get_db
from ..models import utc_now
from ..schemas import LoginRequest, LoginResponse, PreviewAccessRequest, SessionRead, UserRead
from ..users import as_utc, login

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])
settings = Settings.from_environment()


@router.post("/login", response_model=LoginResponse)
def create_session(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    result = login(db, payload.email, payload.password, settings.user_session_hours)
    db.commit()  # Persist failed attempts too: they feed the lockout.
    if result.outcome == "locked":
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many failed attempts; try later")
    if result.outcome != "allowed":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    return LoginResponse(token=result.token, expires_at=result.session.expires_at, user=UserRead.model_validate(result.user))


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def end_session(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> None:
    principal.session.revoked_at = utc_now()
    audit(db, principal, "auth.logout")
    db.commit()


@router.get("/me", response_model=SessionRead)
def whoami(principal: Principal = Depends(current_principal)) -> SessionRead:
    return SessionRead(user=UserRead.model_validate(principal.user), expires_at=as_utc(principal.session.expires_at))


@router.post("/preview-access", status_code=status.HTTP_204_NO_CONTENT)
def authorize_preview(
    payload: PreviewAccessRequest,
    principal: Principal = Depends(require_operator),
    db: Session = Depends(get_db),
) -> None:
    """La web llama aquí antes de abrir el video del nodo; el backend decide y deja rastro."""
    audit(db, principal, "preview.accessed", detail={"camera": payload.camera_id, "kind": payload.kind})
    db.commit()
