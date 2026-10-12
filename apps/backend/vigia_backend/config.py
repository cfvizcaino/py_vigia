from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]
    ingest_api_token: str | None
    ingest_auth_mode: str = "device"
    user_session_hours: int = 8
    # Per process (Uvicorn worker). With WEB_CONCURRENCY=2 the database sees twice this.
    db_pool_size: int = 5
    db_max_overflow: int = 5
    db_pool_timeout: float = 5.0
    max_in_flight: int = 20

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv()
        origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
        mode = os.getenv("INGEST_AUTH_MODE", "device").strip()
        if mode not in {"device", "legacy"}:
            raise ValueError("INGEST_AUTH_MODE debe ser device o legacy")
        token = os.getenv("INGEST_API_TOKEN", "").strip() or None
        if mode == "legacy" and not token:
            raise ValueError("El modo legacy exige INGEST_API_TOKEN; no se permite ingestión anónima")
        hours = int(os.getenv("USER_SESSION_HOURS", "8"))
        if not 1 <= hours <= 24:
            raise ValueError("USER_SESSION_HOURS debe estar entre 1 y 24")
        pool_size = int(os.getenv("DB_POOL_SIZE", "5"))
        max_overflow = int(os.getenv("DB_MAX_OVERFLOW", "5"))
        pool_timeout = float(os.getenv("DB_POOL_TIMEOUT", "5"))
        max_in_flight = int(os.getenv("MAX_IN_FLIGHT", "20"))
        if pool_size < 1 or max_overflow < 0 or pool_timeout <= 0 or max_in_flight < 1:
            raise ValueError("DB_POOL_SIZE ≥ 1, DB_MAX_OVERFLOW ≥ 0, DB_POOL_TIMEOUT > 0 y MAX_IN_FLIGHT ≥ 1")
        return cls(
            database_url=os.getenv("DATABASE_URL", "sqlite:///./data/vigia.db"),
            cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
            ingest_api_token=token,
            ingest_auth_mode=mode,
            user_session_hours=hours,
            db_pool_size=pool_size,
            db_max_overflow=max_overflow,
            db_pool_timeout=pool_timeout,
            max_in_flight=max_in_flight,
        )
