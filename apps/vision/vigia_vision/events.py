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


def update_tracks(
    result: Any,
    tracks: dict[int, TrackState],
    last_seen_monotonic: dict[int, float],
    now_monotonic: float,
    retention_seconds: float,
) -> None:
    """Actualiza el estado de tracks sin depender del transporte de video."""
    now_iso = utc_now()
    boxes = result.boxes
    if boxes is not None and boxes.id is not None:
        for xyxy, class_id, score, track_id in zip(
            boxes.xyxy.cpu().tolist(),
            boxes.cls.int().cpu().tolist(),
            boxes.conf.cpu().tolist(),
            boxes.id.int().cpu().tolist(),
            strict=True,
        ):
            x1, y1, x2, y2 = xyxy
            center = ((x1 + x2) / 2, (y1 + y2) / 2)
            previous = tracks.get(track_id)
            tracks[track_id] = TrackState(
                track_id=track_id,
                vehicle_type={2: "car", 3: "motorcycle"}.get(class_id, str(class_id)),
                confidence=round(float(score), 4),
                first_seen=previous.first_seen if previous else now_iso,
                last_seen=now_iso,
                first_center=previous.first_center if previous else center,
                last_center=center,
                bounding_box=[round(x1), round(y1), round(x2), round(y2)],
            )
            last_seen_monotonic[track_id] = now_monotonic

    expired = [
        track_id
        for track_id, seen_at in last_seen_monotonic.items()
        if now_monotonic - seen_at > retention_seconds
    ]
    for track_id in expired:
        tracks.pop(track_id, None)
        last_seen_monotonic.pop(track_id, None)


def write_snapshot(path: Path, camera_id: str, model: str, frame_number: int, tracks: dict[int, TrackState]) -> None:
    payload = build_snapshot(camera_id, model, frame_number, tracks)
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temporary:
        json.dump(payload, temporary, ensure_ascii=False, indent=2)
        temporary.write("\n")
        temporary_path = Path(temporary.name)
    temporary_path.replace(path)


def build_snapshot(camera_id: str, model: str, frame_number: int, tracks: dict[int, TrackState]) -> dict[str, Any]:
    return {
        "schemaVersion": "1.0",
        "cameraId": camera_id,
        "generatedAt": utc_now(),
        "model": model,
        "frameNumber": frame_number,
        "detections": [track.public_dict() for track in sorted(tracks.values(), key=lambda item: item.track_id)],
    }
