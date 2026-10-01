"""Ranking explicable de hipótesis, NO probabilidades calibradas.

Búsqueda beam acotada sobre observaciones y alternativas viales dirigidas.
El costo OSRM es solo una señal, nunca se elige exclusivamente por distancia.
"""
from __future__ import annotations
from dataclasses import asdict, dataclass, field, replace
from datetime import datetime
import math
import heapq

@dataclass(frozen=True)
class DetectionPoint:
    id: str
    camera_id: str
    vehicle_type: str
    color: str | None
    direction: str
    confidence: float
    observed_at: datetime

@dataclass(frozen=True)
class RoadOption:
    distance_m: float
    duration_s: float | None = None
    weight: float | None = None
    geometry: tuple[tuple[float, float], ...] = ()  # lng, lat
    source: str = "legacy-unverified"
    option_index: int = 0

@dataclass(frozen=True)
class RouteCandidate:
    detection_ids: tuple[str, ...]
    camera_ids: tuple[str, ...]
    vehicle_type: str
    color: str | None
    confidence: float
    has_distant_gaps: bool
    rank: int = 0
    explanation: dict = field(default_factory=dict)
    road_geometry: dict | None = None

@dataclass(frozen=True)
class RoutingConfig:
    nearby_road_m: float = 500.0
    max_road_m: float = 2000.0
    max_speed_kmh: float = 70.0
    min_speed_kmh: float = 8.0
    max_route_length: int = 6
    max_candidates: int = 10
    beam_width: int = 200
    max_detections: int = 500
    detection_weight: float = .35
    time_weight: float = .40
    appearance_weight: float = .15
    road_weight: float = .10
    time_factor: float = 1.35
    time_sigma: float = .65

    def __post_init__(self):
        weights = (self.detection_weight, self.time_weight, self.appearance_weight, self.road_weight)
        if any(not math.isfinite(w) or w < 0 for w in weights) or not math.isclose(sum(weights), 1):
            raise ValueError("Los pesos no negativos deben sumar 1")
        if self.time_factor <= 0 or self.time_sigma <= 0 or self.beam_width < 1 or self.max_route_length < 2:
            raise ValueError("Configuración de búsqueda/tiempo inválida")

RoadLinks = dict[tuple[str, str], float | list[RoadOption]]

def road_options(camera_a: str, camera_b: str, links: RoadLinks) -> list[RoadOption]:
    if camera_a == camera_b:
        return []
    # NO inverse fallback: a one-way A→B does not imply B→A.
    value = links.get((camera_a, camera_b))
    if value is None:
        return []
    return [RoadOption(distance_m=value)] if isinstance(value, (float, int)) else value

def road_distance_m(camera_a, camera_b, links):
    return min((o.distance_m for o in road_options(camera_a, camera_b, links)), default=None)

def implied_speed_kmh(distance_m, delta_seconds):
    return distance_m * 3.6 / delta_seconds if delta_seconds > 0 else None

def score_segments(earlier: DetectionPoint, later: DetectionPoint, links: RoadLinks, config: RoutingConfig) -> list[dict]:
    delta = (later.observed_at - earlier.observed_at).total_seconds()
    if delta <= 0 or earlier.camera_id == later.camera_id or earlier.vehicle_type != later.vehicle_type:
        return []
    if earlier.color and later.color and earlier.color != later.color:
        return []
    options = road_options(earlier.camera_id, later.camera_id, links)
    valid_weights = [o.weight for o in options if o.weight and math.isfinite(o.weight) and o.weight > 0]
    min_weight = min(valid_weights, default=None)
    result = []
    for option in options[:3]:
        distance = option.distance_m
        speed = implied_speed_kmh(distance, delta)
        if not math.isfinite(distance) or distance <= 0 or distance > config.max_road_m:
            continue
        if speed is None or not config.min_speed_kmh <= speed <= config.max_speed_kmh:
            continue
        measured = option.duration_s is not None and math.isfinite(option.duration_s) and option.duration_s > 0
        expected = option.duration_s * config.time_factor if measured else distance / (30 / 3.6)
        timing = math.exp(-.5 * (math.log(delta / expected) / config.time_sigma) ** 2)
        appearance = 1.0 if earlier.color and later.color else .4
        road_prior = min(1.0, min_weight / option.weight) if min_weight and option.weight and option.weight > 0 else .5
        components = {"detection": (earlier.confidence + later.confidence) / 2,
                      "time": timing, "appearance": appearance, "road": road_prior}
        weights = {"detection": config.detection_weight, "time": config.time_weight,
                   "appearance": config.appearance_weight, "road": config.road_weight}
        contributions = {key: components[key] * weights[key] for key in components}
        distant = distance >= config.nearby_road_m
        gap_penalty = .85 if distant else 1.0
        source_penalty = 1.0 if measured and option.source == "osrm" else .85
        result.append({
            "from_camera": earlier.camera_id, "to_camera": later.camera_id,
            "option_index": option.option_index, "distance_m": distance,
            "observed_seconds": delta, "expected_seconds": round(expected, 3),
            "osrm_duration_s": option.duration_s, "osrm_weight": option.weight,
            "implied_speed_kmh": round(speed, 3), "source": option.source,
            "components": components, "contributions": contributions,
            "gap_penalty": gap_penalty, "source_penalty": source_penalty,
            "score": sum(contributions.values()) * gap_penalty * source_penalty,
            "distant": distant, "geometry": option.geometry,
        })
    return sorted(result, key=lambda r: (-r["score"], r["option_index"]))

def pair_is_compatible(earlier, later, links, config):
    segments = score_segments(earlier, later, links, config)
    return (True, segments[0]["score"], segments[0]["distant"]) if segments else (False, 0.0, False)

def _candidate(path: list[DetectionPoint], segments: list[dict], cfg: RoutingConfig) -> RouteCandidate:
    geometric_mean = math.exp(sum(math.log(max(s["score"], 1e-9)) for s in segments) / len(segments))
    bonus = min(.04 * (len(path) - 2), .08)
    score = min(.99, geometric_mean + bonus)
    geometry = None
    if all(s["geometry"] for s in segments):
        coordinates = [p for s in segments for p in s["geometry"]]
        geometry = {"points": [{"lng": p[0], "lat": p[1]} for p in coordinates],
                    "source": "road-network", "distance_m": sum(s["distance_m"] for s in segments)}
    explanation = {
        "model": "weighted-evidence-v2", "calibrated_probability": False,
        "weights": {"detection": cfg.detection_weight, "time": cfg.time_weight,
                    "appearance": cfg.appearance_weight, "road": cfg.road_weight},
        "parameters": asdict(cfg), "geometric_mean": geometric_mean, "coverage_bonus": bonus,
        "direction_used": False,
        "segments": [{k: v for k, v in s.items() if k != "geometry"} for s in segments],
    }
    return RouteCandidate(tuple(p.id for p in path), tuple(p.camera_id for p in path), path[0].vehicle_type,
                          next((p.color for p in path if p.color), None), round(score, 4),
                          any(s["distant"] for s in segments), explanation=explanation, road_geometry=geometry)

def _is_subsequence(short, long):
    if len(short) >= len(long):
        return False
    it = iter(long)
    return all(item in it for item in short)

def reconstruct_routes(detections: list[DetectionPoint], road_links_m: RoadLinks, *,
                       vehicle_type: str | None = None, color: str | None = None,
                       config: RoutingConfig | None = None) -> list[RouteCandidate]:
    cfg = config or RoutingConfig()
    ordered = sorted((d for d in detections if (vehicle_type is None or d.vehicle_type == vehicle_type)
                      and (color is None or d.color == color)), key=lambda p: (p.observed_at, p.id))
    if len(ordered) > cfg.max_detections:
        raise ValueError(f"Máximo {cfg.max_detections} detecciones por búsqueda; reduce ventana o radio")
    edges = {(a.id, b.id): score_segments(a, b, road_links_m, cfg)
             for i, a in enumerate(ordered) for b in ordered[i + 1:]}
    frontier = [([d], []) for d in ordered]
    found = []
    pruned = False
    for _depth in range(2, cfg.max_route_length + 1):
        expanded_count = 0
        def expand():
            nonlocal expanded_count
            for path, segments in frontier:
                known_colors = {p.color for p in path if p.color}
                for nxt in ordered:
                    if nxt.color and known_colors and nxt.color not in known_colors:
                        continue
                    for segment in edges.get((path[-1].id, nxt.id), []):
                        new_path, new_segments = path + [nxt], segments + [segment]
                        score = math.exp(sum(math.log(max(s["score"], 1e-9)) for s in new_segments) / len(new_segments))
                        score = round(min(.99, score + min(.04 * (len(new_path) - 2), .08)), 4)
                        expanded_count += 1
                        yield score, new_path, new_segments
        # Keep only beam_width states, without materializing all expanded geometries.
        selected = heapq.nsmallest(cfg.beam_width, expand(), key=lambda item: (
            -item[0], tuple(p.id for p in item[1]), tuple(s["option_index"] for s in item[2])))
        pruned |= expanded_count > cfg.beam_width
        found.extend(_candidate(p, s, cfg) for _, p, s in selected)
        frontier = [(p, s) for _, p, s in selected]
        if not frontier:
            break
    # Longer chains only dominate subsequences if evidence score is >=.
    found.sort(key=lambda c: (-c.confidence, -len(c.detection_ids), c.detection_ids))
    kept = []
    for candidate in found:
        if any(_is_subsequence(candidate.detection_ids, other.detection_ids) for other in kept):
            continue
        candidate.explanation["search_pruned"] = pruned
        kept.append(candidate)
        if len(kept) == cfg.max_candidates:
            break
    return [replace(c, rank=i) for i, c in enumerate(kept, 1)]
