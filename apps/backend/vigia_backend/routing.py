"""Reconstrucción de rutas candidatas (función pura, sin base de datos).

Agrupa detecciones por tipo+color, filtra tramos por velocidad implícita y
coherencia de dirección, y devuelve varias estimaciones con score — nunca
una sola respuesta como si fuera certera.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

# Umbrales iniciales del PrimerInforme / prototipo Barranquilla.
NEARBY_ROAD_M = 500.0
MAX_ROAD_M = 2000.0
MAX_SPEED_KMH = 70.0  # techo urbano razonable entre cámaras
MIN_SPEED_KMH = 8.0  # evita unir avistamientos demasiado espaciados en el tiempo

OPPOSITE_DIRECTIONS: dict[str, str] = {
    "izquierda-a-derecha": "derecha-a-izquierda",
    "derecha-a-izquierda": "izquierda-a-derecha",
    "arriba-a-abajo": "abajo-a-arriba",
    "abajo-a-arriba": "arriba-a-abajo",
}


@dataclass(frozen=True)
class DetectionPoint:
    """Detección ya materializada en memoria (sin ORM)."""

    id: str
    camera_id: str
    vehicle_type: str
    color: str | None
    direction: str
    confidence: float
    observed_at: datetime


@dataclass(frozen=True)
class RouteCandidate:
    """Una trayectoria estimada; pueden coexistir varias por consulta."""

    detection_ids: tuple[str, ...]
    camera_ids: tuple[str, ...]
    vehicle_type: str
    color: str | None
    confidence: float
    has_distant_gaps: bool
    rank: int = 0


@dataclass(frozen=True)
class RoutingConfig:
    nearby_road_m: float = NEARBY_ROAD_M
    max_road_m: float = MAX_ROAD_M
    max_speed_kmh: float = MAX_SPEED_KMH
    min_speed_kmh: float = MIN_SPEED_KMH
    max_route_length: int = 6
    max_candidates: int = 10


def road_distance_m(
    camera_a: str,
    camera_b: str,
    links: dict[tuple[str, str], float],
) -> float | None:
    if camera_a == camera_b:
        return None
    if (camera_a, camera_b) in links:
        return links[(camera_a, camera_b)]
    if (camera_b, camera_a) in links:
        return links[(camera_b, camera_a)]
    return None


def implied_speed_kmh(distance_m: float, delta_seconds: float) -> float | None:
    if delta_seconds <= 0:
        return None
    return (distance_m / 1000.0) / (delta_seconds / 3600.0)


def directions_compatible(first: str, second: str) -> bool:
    """Rechaza sentidos frontalmente opuestos; indeterminada siempre encaja."""
    if first == "indeterminada" or second == "indeterminada":
        return True
    if OPPOSITE_DIRECTIONS.get(first) == second:
        return False
    return True


def pair_is_compatible(
    earlier: DetectionPoint,
    later: DetectionPoint,
    links: dict[tuple[str, str], float],
    config: RoutingConfig,
) -> tuple[bool, float, bool]:
    """Devuelve (ok, score_tramo 0..1, es_tramo_distante)."""
    if later.observed_at <= earlier.observed_at:
        return False, 0.0, False
    if earlier.camera_id == later.camera_id:
        return False, 0.0, False
    if earlier.vehicle_type != later.vehicle_type:
        return False, 0.0, False
    if earlier.color != later.color:
        return False, 0.0, False
    if not directions_compatible(earlier.direction, later.direction):
        return False, 0.0, False

    distance = road_distance_m(earlier.camera_id, later.camera_id, links)
    if distance is None or distance > config.max_road_m:
        return False, 0.0, False

    delta = (later.observed_at - earlier.observed_at).total_seconds()
    speed = implied_speed_kmh(distance, delta)
    if speed is None or speed < config.min_speed_kmh or speed > config.max_speed_kmh:
        return False, 0.0, False

    distant = distance >= config.nearby_road_m
    # Mejor score si la velocidad está cerca de un urbano típico (~25-35 km/h).
    speed_score = 1.0 - min(abs(speed - 30.0) / 40.0, 1.0)
    conf_score = (earlier.confidence + later.confidence) / 2.0
    direction_score = 1.0 if earlier.direction == later.direction else 0.75
    gap_penalty = 0.65 if distant else 1.0
    segment = conf_score * 0.45 + speed_score * 0.35 + direction_score * 0.20
    return True, max(0.05, min(1.0, segment * gap_penalty)), distant


def _identity_key(point: DetectionPoint) -> tuple[str, str | None]:
    return point.vehicle_type, point.color


def _score_path(
    path: list[DetectionPoint],
    segment_scores: list[float],
    has_distant: bool,
) -> float:
    if not segment_scores:
        return 0.0
    avg_segment = sum(segment_scores) / len(segment_scores)
    avg_det = sum(p.confidence for p in path) / len(path)
    length_bonus = min(0.08 * (len(path) - 2), 0.16)
    score = avg_segment * 0.7 + avg_det * 0.3 + length_bonus
    if has_distant:
        score *= 0.85
    return max(0.05, min(0.99, score))


def _extend_paths(
    group: list[DetectionPoint],
    links: dict[tuple[str, str], float],
    config: RoutingConfig,
) -> list[RouteCandidate]:
    """DFS: construye todas las cadenas compatibles de longitud >= 2."""
    ordered = sorted(group, key=lambda p: (p.observed_at, p.id))
    found: list[RouteCandidate] = []

    def dfs(
        path: list[DetectionPoint],
        used: set[str],
        segment_scores: list[float],
        has_distant: bool,
    ) -> None:
        if len(path) >= 2:
            found.append(
                RouteCandidate(
                    detection_ids=tuple(p.id for p in path),
                    camera_ids=tuple(p.camera_id for p in path),
                    vehicle_type=path[0].vehicle_type,
                    color=path[0].color,
                    confidence=_score_path(path, segment_scores, has_distant),
                    has_distant_gaps=has_distant,
                )
            )
        if len(path) >= config.max_route_length:
            return

        last = path[-1]
        for nxt in ordered:
            if nxt.id in used:
                continue
            if nxt.observed_at <= last.observed_at:
                continue
            ok, seg_score, distant = pair_is_compatible(last, nxt, links, config)
            if not ok:
                continue
            used.add(nxt.id)
            path.append(nxt)
            dfs(path, used, segment_scores + [seg_score], has_distant or distant)
            path.pop()
            used.remove(nxt.id)

    for start in ordered:
        dfs([start], {start.id}, [], False)

    return found


def _dedupe_prefer_longer(candidates: list[RouteCandidate]) -> list[RouteCandidate]:
    """Si una ruta es subsecuencia de otra del mismo vehículo, conserva la más larga."""
    ranked = sorted(
        candidates,
        key=lambda c: (len(c.detection_ids), c.confidence),
        reverse=True,
    )
    kept: list[RouteCandidate] = []
    for cand in ranked:
        ids = cand.detection_ids
        dominated = False
        for other in kept:
            if _is_subsequence(ids, other.detection_ids):
                dominated = True
                break
        if not dominated:
            kept.append(cand)
    return kept


def _is_subsequence(short: tuple[str, ...], long: tuple[str, ...]) -> bool:
    """True si `short` es subsecuencia propia de `long`."""
    if len(short) >= len(long):
        return False
    it = iter(long)
    return all(item in it for item in short)


def reconstruct_routes(
    detections: list[DetectionPoint],
    road_links_m: dict[tuple[str, str], float],
    *,
    vehicle_type: str | None = None,
    color: str | None = None,
    config: RoutingConfig | None = None,
) -> list[RouteCandidate]:
    """Función pura: detecciones + distancias viales → rutas candidatas ordenadas.

    - Agrupa por (vehicle_type, color).
    - Solo une pares físicamente plausibles (velocidad y dirección).
    - Devuelve varias estimaciones con `confidence` y `has_distant_gaps`.
    """
    cfg = config or RoutingConfig()
    filtered = [
        d
        for d in detections
        if (vehicle_type is None or d.vehicle_type == vehicle_type)
        and (color is None or d.color == color)
    ]
    if len(filtered) < 2:
        return []

    groups: dict[tuple[str, str | None], list[DetectionPoint]] = {}
    for point in filtered:
        groups.setdefault(_identity_key(point), []).append(point)

    raw: list[RouteCandidate] = []
    for group in groups.values():
        if len(group) < 2:
            continue
        raw.extend(_extend_paths(group, road_links_m, cfg))

    unique = _dedupe_prefer_longer(raw)
    unique.sort(key=lambda c: c.confidence, reverse=True)
    limited = unique[: cfg.max_candidates]
    return [
        RouteCandidate(
            detection_ids=c.detection_ids,
            camera_ids=c.camera_ids,
            vehicle_type=c.vehicle_type,
            color=c.color,
            confidence=round(c.confidence, 4),
            has_distant_gaps=c.has_distant_gaps,
            rank=index,
        )
        for index, c in enumerate(limited, start=1)
    ]
