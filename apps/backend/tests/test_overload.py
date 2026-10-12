"""Protección ante sobrecarga: descarte de carga con 503 y pool que falla rápido."""

from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import TimeoutError as PoolTimeoutError

from vigia_backend.config import Settings
from vigia_backend.overload import LoadSheddingMiddleware, pool_timeout_handler


class LoadSheddingTests(unittest.IsolatedAsyncioTestCase):
    async def test_excess_requests_get_503_at_once_and_capacity_comes_back(self) -> None:
        release = asyncio.Event()
        inner = FastAPI()

        @inner.get("/slow")
        async def slow() -> dict:
            await release.wait()
            return {"ok": True}

        @inner.get("/health")
        async def health() -> dict:
            return {"status": "ok"}

        app = LoadSheddingMiddleware(inner, max_in_flight=3)
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            held = [asyncio.create_task(client.get("/slow")) for _ in range(3)]
            await asyncio.sleep(0.05)
            self.assertEqual(app.in_flight, 3)

            rejected = await asyncio.wait_for(client.get("/slow"), timeout=1)
            self.assertEqual(rejected.status_code, 503)
            self.assertEqual(rejected.headers["retry-after"], "2")
            # The health check still answers while the process is busy.
            self.assertEqual((await client.get("/health")).status_code, 200)

            release.set()
            self.assertEqual([r.status_code for r in await asyncio.gather(*held)], [200, 200, 200])
            self.assertEqual(app.in_flight, 0)
            self.assertEqual((await client.get("/slow")).status_code, 200)
        self.assertEqual(app.rejected, 1)


class PoolTimeoutTests(unittest.TestCase):
    def test_exhausted_pool_answers_retryable_503(self) -> None:
        app = FastAPI()
        app.add_exception_handler(PoolTimeoutError, pool_timeout_handler)

        @app.get("/busy")
        def busy() -> None:
            raise PoolTimeoutError("QueuePool limit reached")

        response = TestClient(app).get("/busy")
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["retry-after"], "2")

    def test_pool_settings_are_validated(self) -> None:
        with mock.patch.dict(os.environ, {"DB_POOL_TIMEOUT": "0"}):
            with self.assertRaises(ValueError):
                Settings.from_environment()
        with mock.patch.dict(os.environ, {"DB_POOL_SIZE": "8", "MAX_IN_FLIGHT": "30"}):
            settings = Settings.from_environment()
        self.assertEqual((settings.db_pool_size, settings.max_in_flight), (8, 30))


if __name__ == "__main__":
    unittest.main()
