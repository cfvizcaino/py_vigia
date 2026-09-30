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
        return cls(
            database_url=os.getenv("DATABASE_URL", "sqlite:///./data/vigia.db"),
            cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
            ingest_api_token=token,
            ingest_auth_mode=mode,
        )
