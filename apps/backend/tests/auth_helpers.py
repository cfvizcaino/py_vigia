"""Crea personas reales (hash + sesión) para que las pruebas recorran el flujo de auth."""

from __future__ import annotations

from sqlalchemy.orm import Session

from vigia_backend.users import create_user, login

PASSWORD = "contraseña-de-prueba-larga"


def bearer(db: Session, role: str = "operator", email: str | None = None) -> dict[str, str]:
    email = email or f"{role}@vigia.test"
    create_user(db, email, role.title(), role, PASSWORD)
    result = login(db, email, PASSWORD, hours=1)
    db.commit()
    return {"Authorization": f"Bearer {result.token}"}
