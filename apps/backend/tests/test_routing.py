"""Tests del algoritmo puro de reconstrucción de rutas."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from vigia_backend.routing import DetectionPoint, reconstruct_routes

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
