"""Utilidades geográficas simples (sin PostGIS)."""

from __future__ import annotations

from math import asin, cos, radians, sin, sqrt


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Distancia en metros entre dos puntos WGS84."""
    radius_m = 6_371_000.0
    phi1, phi2 = radians(lat1), radians(lat2)
    d_phi = radians(lat2 - lat1)
    d_lambda = radians(lng2 - lng1)
    a = sin(d_phi / 2) ** 2 + cos(phi1) * cos(phi2) * sin(d_lambda / 2) ** 2
    return 2 * radius_m * asin(sqrt(a))
