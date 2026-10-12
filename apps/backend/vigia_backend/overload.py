"""Protección ante sobrecarga: rechazar pronto en lugar de encolar sin límite.

En el benchmark del 12/10/2026, a 200 msg/s el backend aceptaba todas las peticiones; cada
una esperaba hasta 30 s por una conexión del pool, el cliente cortaba y reintentaba, y la
cola de peticiones ya aceptadas tardaba horas en vaciarse: el servicio quedó bloqueado
aun sin carga. Ahora un proceso atiende a lo sumo ``max_in_flight`` peticiones a la vez y
responde 503 con ``Retry-After`` a las demás. Los edges ya reintentan los 5xx con retroceso
y su cola en disco, así que un 503 inmediato no pierde eventos.
"""
from __future__ import annotations

import json

from fastapi import Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

RETRY_AFTER_SECONDS = "2"
_BUSY = json.dumps({"detail": "Servicio saturado; reintenta en unos segundos"}).encode()


class LoadSheddingMiddleware:
    """ASGI: cuenta peticiones HTTP en curso y rechaza las que excedan el límite.

    ``/health`` queda exento para que el chequeo de salud mida si el proceso responde,
    no si está ocupado.
    """

    def __init__(self, app, max_in_flight: int, exempt_paths: tuple[str, ...] = ("/health",)) -> None:
        self.app = app
        self.max_in_flight = max_in_flight
        self.exempt_paths = exempt_paths
        self.in_flight = 0
        self.rejected = 0

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] != "http" or scope.get("path") in self.exempt_paths:
            await self.app(scope, receive, send)
            return
        if self.in_flight >= self.max_in_flight:
            self.rejected += 1
            await send({"type": "http.response.start", "status": 503, "headers": [
                (b"content-type", b"application/json"),
                (b"retry-after", RETRY_AFTER_SECONDS.encode()),
                (b"content-length", str(len(_BUSY)).encode()),
            ]})
            await send({"type": "http.response.body", "body": _BUSY})
            return
        self.in_flight += 1
        try:
            await self.app(scope, receive, send)
        finally:
            self.in_flight -= 1


async def pool_timeout_handler(_: Request, __: PoolTimeoutError) -> JSONResponse:
    """Pool de conexiones agotado: 503 reintentable, no un 500 con traza."""
    return JSONResponse({"detail": "Base de datos ocupada; reintenta en unos segundos"},
                        status_code=503, headers={"Retry-After": RETRY_AFTER_SECONDS})
