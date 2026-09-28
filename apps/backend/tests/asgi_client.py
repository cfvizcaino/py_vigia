"""Adaptador síncrono mínimo sobre el transporte ASGI async de HTTPX."""

from __future__ import annotations

import asyncio
from typing import Any

from httpx import ASGITransport, AsyncClient, Response


class ASGITestClient:
    def __init__(self, app: Any) -> None:
        self.app = app

    def request(self, method: str, url: str, **kwargs: Any) -> Response:
        async def execute() -> Response:
            transport = ASGITransport(app=self.app)
            async with AsyncClient(transport=transport, base_url="http://testserver") as client:
                return await client.request(method, url, **kwargs)

        return asyncio.run(execute())

    def get(self, url: str, **kwargs: Any) -> Response:
        return self.request("GET", url, **kwargs)

    def post(self, url: str, **kwargs: Any) -> Response:
        return self.request("POST", url, **kwargs)

    def patch(self, url: str, **kwargs: Any) -> Response:
        return self.request("PATCH", url, **kwargs)

    def delete(self, url: str, **kwargs: Any) -> Response:
        return self.request("DELETE", url, **kwargs)
