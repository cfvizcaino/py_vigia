"""Un recorte por vehículo para que un admin confirme las rutas (docs/operations/recortes.md).

Misma regla que el edge del teléfono (app 1.4.0): se guarda la vista más grande de cada
track, con un 10 % de margen y el lado mayor en 224 px como máximo, en JPEG de calidad
80 (unos 10 KB). Se vuelve a tomar si la caja crece un 20 %, hasta 4 veces. Se envía una
sola vez, cuando la vista deja de mejorar: el vehículo lleva 1 s sin verse, ya hay 4
tomas o lleva 10 s en cuadro (un carro parqueado). Nunca se guarda la escena completa.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any

MARGIN = 0.10
MAX_SIDE_PX = 224
MIN_SIDE_PX = 32
GROWTH = 1.2
MAX_TAKES = 4
JPEG_QUALITY = 80
MAX_BYTES = 64 * 1024
GONE_SECONDS = 1.0
STAY_SECONDS = 10.0


@dataclass
class Capture:
    jpeg: bytes
    area: int
    takes: int
    first_at: float


def encode_crop(frame: Any, box: list[int], cv2: Any) -> bytes | None:
    """Solo la caja del vehículo con margen, reducida promediando bloques (INTER_AREA)."""
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = box
    margin_x, margin_y = (x2 - x1) * MARGIN, (y2 - y1) * MARGIN
    left, top = max(0, int(x1 - margin_x)), max(0, int(y1 - margin_y))
    right, bottom = min(width, int(x2 + margin_x)), min(height, int(y2 + margin_y))
    if right - left < MIN_SIDE_PX or bottom - top < MIN_SIDE_PX:
        return None
    crop = frame[top:bottom, left:right]
    scale = min(1.0, MAX_SIDE_PX / max(crop.shape[0], crop.shape[1]))
    if scale < 1.0:
        crop = cv2.resize(crop, (max(1, round(crop.shape[1] * scale)), max(1, round(crop.shape[0] * scale))),
                          interpolation=cv2.INTER_AREA)
    for quality in (JPEG_QUALITY, 60):
        ok, buffer = cv2.imencode(".jpg", crop, [cv2.IMWRITE_JPEG_QUALITY, quality])
        if ok and len(buffer) <= MAX_BYTES:
            return buffer.tobytes()
    return None


class ThumbnailCollector:
    """Elige el mejor recorte de cada track y dice cuándo enviarlo."""

    def __init__(self) -> None:
        self._captures: dict[int, Capture] = {}
        self._sent: set[int] = set()

    def observe(self, frame: Any, boxes: dict[int, list[int]], now: float, cv2: Any) -> None:
        for track_id, box in boxes.items():
            if track_id in self._sent:
                continue
            width, height = box[2] - box[0], box[3] - box[1]
            if width < MIN_SIDE_PX or height < MIN_SIDE_PX:
                continue
            area = width * height
            previous = self._captures.get(track_id)
            if previous and (previous.takes >= MAX_TAKES or area < previous.area * GROWTH):
                continue
            jpeg = encode_crop(frame, box, cv2)
            if jpeg is None:
                continue
            self._captures[track_id] = Capture(jpeg, area, (previous.takes if previous else 0) + 1,
                                               previous.first_at if previous else now)

    def due(self, last_seen: dict[int, float], published: set[int], now: float, *, flush: bool = False) -> list[tuple[int, bytes]]:
        """Recortes listos de tracks que ya salieron en un sobre (el centro debe conocerlos)."""
        ready: list[tuple[int, bytes]] = []
        for track_id, capture in list(self._captures.items()):
            seen = last_seen.get(track_id)
            if track_id not in published:
                if seen is None:  # Gone without ever being published: nothing to attach it to.
                    del self._captures[track_id]
                continue
            if flush or seen is None or now - seen >= GONE_SECONDS or capture.takes >= MAX_TAKES or now - capture.first_at >= STAY_SECONDS:
                ready.append((track_id, capture.jpeg))
                del self._captures[track_id]
                self._sent.add(track_id)
        # Track ids only grow within a session; forget the ones no longer alive.
        self._sent &= set(last_seen)
        return ready
