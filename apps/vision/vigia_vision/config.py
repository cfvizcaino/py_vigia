from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote

from dotenv import load_dotenv

from . import __version__


@dataclass(frozen=True)
class Settings:
    camera_id: str
    model: str
    confidence: float
    plate_model: str | None
    plate_confidence: float
    plate_every_n_frames: int
    plate_output: Path
    output: Path
    tapo_host: str | None
    tapo_username: str | None
    tapo_password: str | None
    tapo_stream: str
    node_version: str
    model_version: str
    model_digest: str | None
    central_api_url: str | None
    central_api_token: str | None
    event_outbox: Path
    event_queue_max: int
    publish_timeout_seconds: float

    @classmethod
    def from_environment(cls) -> "Settings":
        load_dotenv()
        confidence = float(os.getenv("YOLO_CONFIDENCE", "0.35"))
        if not 0 < confidence <= 1:
            raise ValueError("YOLO_CONFIDENCE debe estar entre 0 y 1")

        plate_confidence = float(os.getenv("PLATE_CONFIDENCE", "0.45"))
        if not 0 < plate_confidence <= 1:
            raise ValueError("PLATE_CONFIDENCE debe estar entre 0 y 1")

        plate_every_n_frames = int(os.getenv("PLATE_EVERY_N_FRAMES", "5"))
        if plate_every_n_frames < 1:
            raise ValueError("PLATE_EVERY_N_FRAMES debe ser mayor o igual a 1")

        stream = os.getenv("TAPO_STREAM", "stream1")
        if stream not in {"stream1", "stream2"}:
            raise ValueError("TAPO_STREAM debe ser stream1 o stream2")

        event_queue_max = int(os.getenv("EVENT_QUEUE_MAX", "10000"))
        if event_queue_max < 1:
            raise ValueError("EVENT_QUEUE_MAX debe ser mayor o igual a 1")

        publish_timeout_seconds = float(os.getenv("PUBLISH_TIMEOUT_SECONDS", "10"))
        if publish_timeout_seconds <= 0:
            raise ValueError("PUBLISH_TIMEOUT_SECONDS debe ser mayor que 0")

        model = os.getenv("YOLO_MODEL", "yolo26n.pt")

        return cls(
            camera_id=os.getenv("VIGIA_CAMERA_ID", "CAM-01"),
            model=model,
            confidence=confidence,
            plate_model=os.getenv("PLATE_MODEL", "").strip() or None,
            plate_confidence=plate_confidence,
            plate_every_n_frames=plate_every_n_frames,
            plate_output=Path(os.getenv("PLATE_OUTPUT", "outputs/plates")),
            output=Path(os.getenv("DETECTION_OUTPUT", "outputs/detections.json")),
            tapo_host=os.getenv("TAPO_HOST"),
            tapo_username=os.getenv("TAPO_USERNAME"),
            tapo_password=os.getenv("TAPO_PASSWORD"),
            tapo_stream=stream,
            node_version=os.getenv("VIGIA_NODE_VERSION", __version__),
            model_version=os.getenv("VIGIA_MODEL_VERSION", model),
            model_digest=os.getenv("VIGIA_MODEL_DIGEST", "").strip() or None,
            central_api_url=os.getenv("VIGIA_CENTRAL_API_URL", "").strip() or None,
            central_api_token=os.getenv("VIGIA_CENTRAL_API_TOKEN", "").strip() or None,
            event_outbox=Path(os.getenv("EVENT_OUTBOX", "outputs/outbox")),
            event_queue_max=event_queue_max,
            publish_timeout_seconds=publish_timeout_seconds,
        )

    def rtsp_url(self) -> str:
        missing = [
            name
            for name, value in (
                ("TAPO_HOST", self.tapo_host),
                ("TAPO_USERNAME", self.tapo_username),
                ("TAPO_PASSWORD", self.tapo_password),
            )
            if not value
        ]
        if missing:
            raise ValueError(f"Falta configurar: {', '.join(missing)}")

        username = quote(self.tapo_username or "", safe="")
        password = quote(self.tapo_password or "", safe="")
        return f"rtsp://{username}:{password}@{self.tapo_host}:554/{self.tapo_stream}"
