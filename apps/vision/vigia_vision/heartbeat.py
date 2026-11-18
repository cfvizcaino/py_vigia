"""Latido del nodo PC hacia el centro (backend: liveness.py).

Cada 30 s informa si el nodo sigue procesando, su ritmo y su cola. Al detenerse avisa
`stopped`. Si el proceso muere o la red se cae, los latidos dejan de llegar y la consola
lo muestra como «sin señal». Un latido perdido no se reintenta: el siguiente lo reemplaza.
"""

from __future__ import annotations

import json
import threading
from typing import Any, Callable
from urllib.error import URLError
from urllib.request import Request, urlopen

INTERVAL_SECONDS = 30.0


class HeartbeatSender:
    def __init__(
        self,
        central_api_url: str | None,
        device_token: str | None,
        camera_id: str,
        session_id: str,
        node_version: str,
        read: Callable[[], dict[str, Any]],
        *,
        interval_seconds: float = INTERVAL_SECONDS,
        timeout_seconds: float = 8.0,
    ) -> None:
        self.url = f"{central_api_url.rstrip('/')}/api/v1/ingest/heartbeat" if central_api_url else None
        self.device_token = device_token
        self.camera_id = camera_id
        self.session_id = session_id
        self.node_version = node_version
        self.read = read
        self.interval_seconds = interval_seconds
        self.timeout_seconds = timeout_seconds
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self.sent = 0
        self.failed = 0

    def start(self) -> None:
        if self.url is None or self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="vigia-heartbeat", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self.url is None:
            return
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=self.timeout_seconds + 1)
        self.send("stopped")

    def _run(self) -> None:
        while not self._stop_event.is_set():
            self.send("running")
            self._stop_event.wait(self.interval_seconds)

    def send(self, state: str) -> bool:
        if self.url is None:
            return False
        body = {"cameraId": self.camera_id, "sessionId": self.session_id, "state": state,
                "nodeVersion": self.node_version, "platform": "pc"}
        try:
            body.update({key: value for key, value in self.read().items() if value is not None})
        except Exception:  # noqa: BLE001 - a broken reading must not stop the heartbeat
            pass
        headers = {"Content-Type": "application/json", "User-Agent": "vigia-edge/1.1"}
        if self.device_token:
            headers["X-Vigia-Device-Token"] = self.device_token
        request = Request(self.url, data=json.dumps(body).encode("utf-8"), headers=headers, method="POST")
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310 - URL is operator config
                ok = 200 <= response.status < 300
        except (URLError, OSError, ValueError):
            ok = False
        if ok:
            self.sent += 1
        else:
            self.failed += 1
        return ok
