"""Cola persistente y publicador HTTP de Detection Envelope 1.1."""

from __future__ import annotations

import json
import threading
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .events import utc_now


class SnapshotPublisher:
    """Guarda primero en disco y elimina solo después del acuse central."""

    def __init__(
        self,
        central_api_url: str | None,
        device_token: str | None,
        outbox: Path,
        *,
        queue_max: int = 10_000,
        timeout_seconds: float = 10.0,
    ) -> None:
        self.central_api_url = central_api_url.rstrip("/") if central_api_url else None
        self.device_token = device_token
        self.outbox = outbox
        self.queue_max = queue_max
        self.timeout_seconds = timeout_seconds
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._last_delivered_at: str | None = None
        self._last_error: str | None = None

    @property
    def enabled(self) -> bool:
        return self.central_api_url is not None

    def start(self) -> None:
        if not self.enabled or self._thread and self._thread.is_alive():
            return
        self.outbox.mkdir(parents=True, exist_ok=True)
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="vigia-event-publisher", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        self._wake_event.set()
        if self._thread:
            self._thread.join(timeout=5)

    def enqueue(self, payload: dict[str, Any]) -> bool:
        if not self.enabled:
            return False
        self.outbox.mkdir(parents=True, exist_ok=True)
        if self.pending_count() >= self.queue_max:
            with self._lock:
                self._last_error = "OUTBOX_FULL"
            return False

        sequence = int(payload["sequenceNumber"])
        event_id = str(payload["eventId"])
        destination = self.outbox / f"{sequence:020d}-{event_id}.json"
        if destination.exists():
            return True
        with NamedTemporaryFile("w", encoding="utf-8", dir=self.outbox, delete=False) as temporary:
            json.dump(payload, temporary, ensure_ascii=False, separators=(",", ":"))
            temporary.write("\n")
            temporary_path = Path(temporary.name)
        temporary_path.replace(destination)
        self._wake_event.set()
        return True

    def pending_count(self) -> int:
        if not self.outbox.exists():
            return 0
        return sum(1 for _ in self.outbox.glob("*.json"))

    def status(self) -> dict[str, Any]:
        with self._lock:
            last_delivered_at = self._last_delivered_at
            last_error = self._last_error
        return {
            "enabled": self.enabled,
            "pendingEvents": self.pending_count(),
            "lastDeliveredAt": last_delivered_at,
            "lastError": last_error,
        }

    def _next_event(self) -> Path | None:
        return next(iter(sorted(self.outbox.glob("*.json"))), None)

    def _run(self) -> None:
        backoff_seconds = 1.0
        while not self._stop_event.is_set():
            path = self._next_event()
            if path is None:
                self._wake_event.clear()
                self._wake_event.wait(timeout=5)
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                self._send(payload)
                path.unlink(missing_ok=True)
                with self._lock:
                    self._last_delivered_at = utc_now()
                    self._last_error = None
                backoff_seconds = 1.0
            except (OSError, ValueError, HTTPError, URLError) as exc:
                with self._lock:
                    self._last_error = type(exc).__name__
                if self._stop_event.wait(backoff_seconds):
                    return
                backoff_seconds = min(backoff_seconds * 2, 60.0)

    def _send(self, payload: dict[str, Any]) -> None:
        if self.central_api_url is None:
            return
        headers = {"Content-Type": "application/json", "User-Agent": "vigia-edge/1.1"}
        if self.device_token:
            headers["X-Vigia-Device-Token"] = self.device_token
        request = Request(
            f"{self.central_api_url}/api/v1/ingest/detections",
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        with urlopen(request, timeout=self.timeout_seconds) as response:  # noqa: S310 - URL is operator config
            if response.status < 200 or response.status >= 300:
                raise HTTPError(request.full_url, response.status, "ingest rejected", response.headers, None)
