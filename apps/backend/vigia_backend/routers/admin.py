"""Operaciones exclusivas del rol admin: auditoría y credenciales de nodos."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from ..auth import Principal, require_admin
from ..db import get_db
from ..device_credentials import issue, revoke
from ..models import Device, DeviceCredential, SecurityAudit, User
from ..schemas import AuditRead, CredentialIssued, CredentialIssueRequest, CredentialRead

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

# Groups shown in the admin screen; each maps to action prefixes.
AUDIT_CATEGORIES: dict[str, tuple[str, ...]] = {
    "sessions": ("auth.", "user."),
    "queries": ("query.",),
    "preview": ("preview.",),
    "changes": ("device.", "detection."),
    "credentials": ("credential.", "ingest."),
    "denied": ("authz.",),
}


@router.get("/audit", response_model=list[AuditRead])
def list_audit(
    action: str | None = Query(default=None, max_length=64),
    category: Literal["sessions", "queries", "preview", "changes", "credentials", "denied"] | None = None,
    before: datetime | None = Query(default=None, description="Paginación: solo eventos anteriores a este instante"),
    limit: int = Query(default=100, ge=1, le=500),
    _: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[AuditRead]:
    statement = (
        select(SecurityAudit, User.email)
        .outerjoin(User, User.id == SecurityAudit.user_id)
        .order_by(SecurityAudit.occurred_at.desc())
        .limit(limit)
    )
    if action is not None:
        statement = statement.where(SecurityAudit.action == action)
    if category is not None:
        statement = statement.where(or_(*(SecurityAudit.action.startswith(prefix) for prefix in AUDIT_CATEGORIES[category])))
    if before is not None:
        statement = statement.where(SecurityAudit.occurred_at < before)
    return [AuditRead.model_validate(row).model_copy(update={"user_email": email}) for row, email in db.execute(statement).all()]


@router.get("/credentials", response_model=list[CredentialRead])
def list_credentials(_: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> list[CredentialRead]:
    rows = db.execute(select(DeviceCredential, Device.external_id).join(Device, Device.id == DeviceCredential.device_id)).all()
    return [
        CredentialRead(id=c.id, camera_id=camera, created_at=c.created_at, expires_at=c.expires_at, revoked=c.revoked_at is not None)
        for c, camera in rows
    ]


@router.post("/devices/{camera_id}/credentials", response_model=CredentialIssued, status_code=status.HTTP_201_CREATED)
def issue_credential(
    camera_id: str,
    payload: CredentialIssueRequest,
    principal: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
) -> CredentialIssued:
    try:
        credential, secret = issue(db, camera_id, payload.days, user_id=principal.user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    db.commit()
    return CredentialIssued(
        id=credential.id, camera_id=camera_id, created_at=credential.created_at,
        expires_at=credential.expires_at, revoked=False, secret=secret,
    )


@router.delete("/credentials/{credential_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_credential(credential_id: uuid.UUID, principal: Principal = Depends(require_admin), db: Session = Depends(get_db)) -> None:
    try:
        revoke(db, credential_id, user_id=principal.user.id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    db.commit()
