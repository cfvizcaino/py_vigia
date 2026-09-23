from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv


@dataclass(frozen=True)
class Settings:
    database_url: str
    cors_origins: tuple[str, ...]

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv()
        origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
        return cls(
            database_url=os.getenv("DATABASE_URL", "sqlite:///./data/vigia.db"),
            cors_origins=tuple(origin.strip() for origin in origins.split(",") if origin.strip()),
        )
