"""Punto de entrada FastAPI del backend central (monolito modular)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .db import init_db
from .routers import detections, devices, queries

settings = Settings.from_environment()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Crea las tablas al arrancar; migraciones Alembic vendrán después.
    init_db()
    yield


app = FastAPI(
    title="VIGIA Backend API",
    version="0.1.0",
    description="Plataforma central modular: dispositivos, detecciones y consultas.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(devices.router)
app.include_router(detections.router)
app.include_router(queries.router)


@app.get("/health")
def health() -> dict:
    return {"service": "vigia-backend", "status": "ok"}
