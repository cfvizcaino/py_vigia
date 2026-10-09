"""Tests del algoritmo puro de reconstrucción de rutas."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from vigia_backend.routing import DetectionPoint, RoadOption, RoutingConfig, reconstruct_routes

LINKS = {
    ("CAM-01", "CAM-02"): 420.0,
    ("CAM-01", "CAM-03"): 1650.0,
    ("CAM-01", "CAM-04"): 1950.0,
    ("CAM-02", "CAM-03"): 1250.0,
    ("CAM-02", "CAM-04"): 1720.0,
    ("CAM-03", "CAM-04"): 620.0,
}

T0 = datetime(2026, 8, 25, 14, 30, 0, tzinfo=timezone.utc)


def _det(
    id_: str,
    camera: str,
    vehicle_type: str,
    color: str | None,
    direction: str,
    minutes: float,
    confidence: float = 0.9,
) -> DetectionPoint:
    return DetectionPoint(
        id=id_,
        camera_id=camera,
        vehicle_type=vehicle_type,
        color=color,
        direction=direction,
        confidence=confidence,
        observed_at=T0 + timedelta(minutes=minutes),
    )


def test_clear_route_between_nearby_cameras() -> None:
    """Ruta clara CAM-01 → CAM-02 (~54 s a velocidad urbana)."""
    detections = [
        _det("a1", "CAM-01", "car", "white", "izquierda-a-derecha", 0.0, 0.94),
        # 420 m a 28 km/h ≈ 0.9 min
        _det("a2", "CAM-02", "car", "white", "izquierda-a-derecha", 0.9, 0.91),
        # Ruido que no debe formar ruta propia de 2+ con el blanco cercano
        _det("noise", "CAM-01", "car", "red", "indeterminada", 2.0, 0.7),
    ]

    routes = reconstruct_routes(detections, LINKS, vehicle_type="car", color="white")

    assert len(routes) >= 1
    best = routes[0]
    assert best.camera_ids == ("CAM-01", "CAM-02")
    assert best.detection_ids == ("a1", "a2")
    assert best.has_distant_gaps is False
    assert best.confidence > 0.5
    # Varias candidatas posibles en general; aquí solo una coherente
    assert all(r.rank >= 1 for r in routes)


def test_route_with_distant_gaps_has_lower_confidence() -> None:
    """Ruta CAM-01 → CAM-03 → CAM-04 con tramos > 500 m vial."""
    nearby = [
        _det("n1", "CAM-01", "car", "white", "izquierda-a-derecha", 0.0),
        _det("n2", "CAM-02", "car", "white", "izquierda-a-derecha", 0.9),
    ]
    distant = [
        _det("d1", "CAM-01", "car", "gray", "izquierda-a-derecha", 5.0, 0.90),
        # 1650 m a ~28 km/h ≈ 3.5 min
        _det("d2", "CAM-03", "car", "gray", "izquierda-a-derecha", 8.5, 0.84),
        # 620 m ≈ 1.3 min
        _det("d3", "CAM-04", "car", "gray", "arriba-a-abajo", 9.8, 0.81),
    ]

    nearby_routes = reconstruct_routes(nearby, LINKS)
    distant_routes = reconstruct_routes(distant, LINKS)

    assert nearby_routes
    assert distant_routes
    near_best = nearby_routes[0]
    far_best = next(r for r in distant_routes if r.camera_ids == ("CAM-01", "CAM-03", "CAM-04"))

    assert far_best.has_distant_gaps is True
    assert near_best.has_distant_gaps is False
    assert far_best.confidence < near_best.confidence


def test_two_similar_vehicles_are_not_merged() -> None:
    """Dos autos blancos en ventanas lejanas no deben unirse en una sola ruta."""
    early = [
        _det("e1", "CAM-01", "car", "white", "izquierda-a-derecha", 0.0),
        _det("e2", "CAM-02", "car", "white", "izquierda-a-derecha", 0.9),
    ]
    late = [
        _det("l1", "CAM-03", "car", "white", "arriba-a-abajo", 40.0),
        _det("l2", "CAM-04", "car", "white", "arriba-a-abajo", 41.3),
    ]
    # Ruido blanco en medio con dirección opuesta (no debe puentear early→late)
    bridge_attempt = [
        _det("b1", "CAM-03", "car", "white", "derecha-a-izquierda", 8.0, 0.7),
    ]

    routes = reconstruct_routes(early + late + bridge_attempt, LINKS, color="white")

    assert len(routes) >= 2
    camera_seqs = {r.camera_ids for r in routes}
    assert ("CAM-01", "CAM-02") in camera_seqs
    assert ("CAM-03", "CAM-04") in camera_seqs
    # No debe existir una ruta que una el bloque temprano con el tardío
    for route in routes:
        ids = set(route.detection_ids)
        assert not ({"e1", "e2"} <= ids and {"l1", "l2"} <= ids)


def test_returns_multiple_ranked_estimates_not_a_single_certainty() -> None:
    detections = [
        _det("a1", "CAM-01", "motorcycle", "black", "derecha-a-izquierda", 12.0),
        _det("a2", "CAM-02", "motorcycle", "black", "derecha-a-izquierda", 12.9),
        _det("a3", "CAM-03", "motorcycle", "black", "derecha-a-izquierda", 15.5),
        _det("a4", "CAM-04", "motorcycle", "black", "abajo-a-arriba", 16.8),
    ]
    routes = reconstruct_routes(detections, LINKS)
    assert len(routes) >= 1
    assert routes[0].rank == 1
    if len(routes) > 1:
        assert routes[0].confidence >= routes[1].confidence
        assert {r.rank for r in routes} == set(range(1, len(routes) + 1))


def test_longer_alternative_wins_when_elapsed_time_supports_it():
    points = [_det("a", "A", "car", "white", "indeterminada", 0),
              _det("b", "B", "car", "white", "indeterminada", 1.35)]
    links = {("A", "B"): [RoadOption(600, 25, 25, ((0, 0), (1, 1)), "osrm", 0),
                           RoadOption(900, 60, 60, ((0, 0), (2, 1), (1, 1)), "osrm", 1)]}
    routes = reconstruct_routes(points, links)
    assert len(routes) == 2
    assert routes[0].explanation["segments"][0]["option_index"] == 1
    assert routes[0].road_geometry["distance_m"] == 900
    assert routes[0].road_geometry["points"][1]["lng"] == 2
    assert routes[0].confidence > routes[1].confidence
    # Changing actual weights changes the winner, not merely the explanation.
    shortest = reconstruct_routes(points, links, config=RoutingConfig(detection_weight=0, time_weight=0, appearance_weight=0, road_weight=1))
    assert shortest[0].explanation["segments"][0]["option_index"] == 0

def test_one_way_links_are_not_invented_in_reverse():
    points = [_det("b", "B", "car", "white", "indeterminada", 0),
              _det("a", "A", "car", "white", "indeterminada", .9)]
    assert reconstruct_routes(points, {("A", "B"): 420}) == []

def test_unmapped_image_directions_do_not_reject_real_world_motion():
    points = [_det("a", "A", "car", "white", "izquierda-a-derecha", 0),
              _det("b", "B", "car", "white", "derecha-a-izquierda", .9)]
    best = reconstruct_routes(points, {("A", "B"): 420})[0]
    assert best.explanation["direction_used"] is False

def test_missing_color_is_not_positive_identity_evidence():
    points = [_det("a", "A", "car", None, "indeterminada", 0),
              _det("b", "B", "car", None, "indeterminada", .9)]
    best = reconstruct_routes(points, {("A", "B"): 420})[0]
    assert best.explanation["segments"][0]["components"]["appearance"] == .4
    assert best.explanation["calibrated_probability"] is False

def test_explanation_reproduces_score():
    points = [_det("a", "A", "car", "white", "indeterminada", 0),
              _det("b", "B", "car", "white", "indeterminada", .9)]
    best = reconstruct_routes(points, {("A", "B"): 420})[0]
    s = best.explanation["segments"][0]
    expected = sum(s["contributions"].values()) * s["gap_penalty"] * s["source_penalty"]
    assert best.confidence == pytest.approx(expected, abs=.0001)
    assert s["source"] == "legacy-unverified"

def test_rejects_invalid_weights_and_excessive_search():
    with pytest.raises(ValueError):
        RoutingConfig(time_weight=.8)
    with pytest.raises(ValueError):
        RoutingConfig(time_weight=float("nan"))
    points = [_det(str(i), "A", "car", None, "indeterminada", i) for i in range(4)]
    with pytest.raises(ValueError, match="reduce ventana"):
        reconstruct_routes(points, {}, config=RoutingConfig(max_detections=3))

def test_bounded_search_discloses_pruning_and_is_deterministic():
    points = [_det("a", "A", "car", "white", "indeterminada", 0),
              _det("b", "B", "car", "white", "indeterminada", .9),
              _det("c", "C", "car", "white", "indeterminada", .95)]
    links = {("A", "B"): 420, ("A", "C"): 430}
    config = RoutingConfig(beam_width=1)
    routes = reconstruct_routes(points, links, config=config)
    assert routes[0].explanation["search_pruned"] is True
    assert routes == reconstruct_routes(list(reversed(points)), links, config=config)
