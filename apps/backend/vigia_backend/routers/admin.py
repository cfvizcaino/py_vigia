"""Operaciones exclusivas del rol admin: auditoría y credenciales de nodos."""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..auth import Principal, require_admin
from ..db import get_db
from ..device_credentials import issue, revoke
from ..models import Device, DeviceCredential, SecurityAudit
from ..schemas import AuditRead, CredentialIssued, CredentialIssueRequest, CredentialRead

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


@router.get("/audit", response_model=list[AuditRead])
def list_audit(
    action: str | None = Query(default=None, max_length=64),
    limit: int = Query(default=100, ge=1, le=500),
    _: Principal = Depends(require_admin),
    db: Session = Depends(get_db),
) -> list[SecurityAudit]:
    statement = select(SecurityAudit).order_by(SecurityAudit.occurred_at.desc()).limit(limit)
    if action is not None:
        statement = statement.where(SecurityAudit.action == action)
    return list(db.scalars(statement).all())


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
