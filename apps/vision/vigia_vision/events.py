from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any


@dataclass
class TrackState:
    track_id: int
    vehicle_type: str
    confidence: float
    first_seen: str
    last_seen: str
    first_center: tuple[float, float]
    last_center: tuple[float, float]
    bounding_box: list[int]

    @property
    def direction(self) -> str:
        dx = self.last_center[0] - self.first_center[0]
        dy = self.last_center[1] - self.first_center[1]
        if abs(dx) < 25 and abs(dy) < 25:
            return "indeterminada"
        if abs(dx) >= abs(dy):
            return "izquierda-a-derecha" if dx > 0 else "derecha-a-izquierda"
        return "arriba-a-abajo" if dy > 0 else "abajo-a-arriba"

    def public_dict(self) -> dict[str, Any]:
        return {
            "trackId": self.track_id,
            "vehicleType": self.vehicle_type,
            "confidence": self.confidence,
            "firstSeen": self.first_seen,
            "lastSeen": self.last_seen,
            "direction": self.direction,
            "boundingBox": self.bounding_box,
            "color": None,
            "make": None,
            "model": None,
            "licensePlate": None,
        }


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def write_snapshot(path: Path, camera_id: str, model: str, frame_number: int, tracks: dict[int, TrackState]) -> None:
    payload = {
        "schemaVersion": "1.0",
        "cameraId": camera_id,
        "generatedAt": utc_now(),
        "model": model,
        "frameNumber": frame_number,
        "detections": [track.public_dict() for track in sorted(tracks.values(), key=lambda item: item.track_id)],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)
