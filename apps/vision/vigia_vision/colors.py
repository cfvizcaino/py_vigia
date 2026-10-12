"""Color del vehículo: un clasificador sobre el recorte de cada track, votado entre cuadros.

Un solo cuadro engaña (reflejos, sombras, desenfoque), así que cada track acumula las
probabilidades de varios recortes y solo reporta un color cuando el promedio es claro. Si
no lo es, el color queda en None: es mejor "desconocido" que un color equivocado, porque
las consultas filtran por igualdad. La app móvil aplica la misma regla
(apps/movil/lib/edge_mode/colors.dart).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

MIN_SIDE_PX = 24
MAX_VOTES = 5
MIN_VOTES = 2
MIN_CONFIDENCE = 0.5
RECLASSIFY_SECONDS = 0.5
MAX_CROPS_PER_FRAME = 3


@dataclass
class ColorVotes:
    sums: dict[str, float] = field(default_factory=dict)
    votes: int = 0
    last_at: float | None = None

    def add(self, probabilities: dict[str, float], now: float) -> None:
        for name, value in probabilities.items():
            self.sums[name] = self.sums.get(name, 0.0) + value
        self.votes += 1
        self.last_at = now

    @property
    def color(self) -> str | None:
        if self.votes < MIN_VOTES or not self.sums:
            return None
        name, total = max(self.sums.items(), key=lambda item: item[1])
        return name if total / self.votes >= MIN_CONFIDENCE else None

    def wants_sample(self, now: float) -> bool:
        return self.votes < MAX_VOTES and (self.last_at is None or now - self.last_at >= RECLASSIFY_SECONDS)


def crop(frame: Any, box: list[int]) -> Any | None:
    """Recorte del vehículo; None si es tan pequeño que el color no sería fiable."""
    height, width = frame.shape[:2]
    x1, y1, x2, y2 = (max(0, box[0]), max(0, box[1]), min(width, box[2]), min(height, box[3]))
    if x2 - x1 < MIN_SIDE_PX or y2 - y1 < MIN_SIDE_PX:
        return None
    return frame[y1:y2, x1:x2]


def classify_tracks(
    model: Any,
    frame: Any,
    boxes: dict[int, list[int]],
    votes: dict[int, ColorVotes],
    now: float,
) -> None:
    """Clasifica los tracks vistos en este cuadro que aún necesitan muestras de color.

    ``boxes`` son los tracks del cuadro actual (id → caja en píxeles). Se priorizan los que
    tienen menos votos y se limita el número de recortes para no frenar la detección.
    """
    pending = sorted(
        (track_id for track_id in boxes if votes.setdefault(track_id, ColorVotes()).wants_sample(now)),
        key=lambda track_id: votes[track_id].votes,
    )
    selected: list[tuple[int, Any]] = []
    for track_id in pending:
        image = crop(frame, boxes[track_id])
        if image is not None:
            selected.append((track_id, image))
        if len(selected) == MAX_CROPS_PER_FRAME:
            break
    if not selected:
        return
    # Ultralytics resizes and centre-crops each crop exactly as in training.
    results = model.predict([image for _, image in selected], verbose=False)
    for (track_id, _), result in zip(selected, results, strict=True):
        probabilities = result.probs.data.tolist()
        votes[track_id].add({result.names[i]: float(p) for i, p in enumerate(probabilities)}, now)


def prune(votes: dict[int, ColorVotes], live_track_ids: set[int]) -> None:
    for track_id in [track_id for track_id in votes if track_id not in live_track_ids]:
        del votes[track_id]
