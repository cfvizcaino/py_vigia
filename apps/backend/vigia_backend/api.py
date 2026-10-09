"""Punto de entrada FastAPI del backend central (monolito modular)."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import __version__
from .config import Settings
from .db import init_db
from .routers import admin, auth, detections, devices, ingest, queries, scenarios

settings = Settings.from_environment()


@asynccontextmanager
async def lifespan(_: FastAPI):
    # El arranque no altera silenciosamente el esquema ni estampa bases antiguas.
    init_db()
    yield


app = FastAPI(
    title="VIGIA Backend API",
    version=__version__,
    description="Plataforma central modular: dispositivos, detecciones y consultas.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(auth.router)
app.include_router(admin.router)
app.include_router(devices.router)
app.include_router(detections.router)
app.include_router(ingest.router)
app.include_router(queries.router)
app.include_router(scenarios.router)


@app.get("/health")
def health() -> dict:
    return {"service": "vigia-backend", "status": "ok"}
