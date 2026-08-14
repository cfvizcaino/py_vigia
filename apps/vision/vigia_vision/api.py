from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Response
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings
from .runtime import VisionRuntime

settings = Settings.from_environment()
runtime = VisionRuntime(settings)


@asynccontextmanager
async def lifespan(_: FastAPI):
    runtime.start()
    yield
    runtime.stop()


app = FastAPI(
    title="VIGIA Vision API",
    version="0.1.0",
    description="Adaptador HTTP seguro para el nodo de visión y la cámara Tapo C110.",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return runtime.status()


@app.get("/api/v1/status")
def status() -> dict:
    return runtime.status()


@app.get("/api/v1/detections")
def detections() -> dict:
    return runtime.detections()


@app.get("/api/v1/preview.jpg")
def preview() -> Response:
    image = runtime.preview()
    if image is None:
        return Response(status_code=503, headers={"Cache-Control": "no-store"})
    return Response(content=image, media_type="image/jpeg", headers={"Cache-Control": "no-store, max-age=0"})
