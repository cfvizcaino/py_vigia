"""Cola persistente y publicador HTTP de Detection Envelope 1.1."""

from __future__ import annotations

import json
import random
import threading
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .events import utc_now

# The central answered and will never accept this exact event: set it aside and keep the
# queue moving instead of blocking every later event behind it (head-of-line blocking).
EVENT_REJECTED = frozenset({400, 409, 413, 422})
# 401/403/404 concern the whole node (token, camera registration): retry, never discard.
MAX_BACKOFF_SECONDS = 30.0


class SnapshotPublisher:
    """Guarda primero en disco y elimina solo después del acuse central.

    Los eventos rechazados de forma definitiva pasan a ``outbox/rejected`` para revisión.
    """

    def __init__(
        self,
        central_api_url: str | None,
        device_token: str | None,
        outbox: Path,
        *,
        queue_max: int = 10_000,
        timeout_seconds: float = 10.0,
        initial_backoff_seconds: float = 1.0,
        max_backoff_seconds: float = MAX_BACKOFF_SECONDS,
    ) -> None:
        self.central_api_url = central_api_url.rstrip("/") if central_api_url else None
        self.device_token = device_token
        self.outbox = outbox
        self.queue_max = queue_max
        self.timeout_seconds = timeout_seconds
        self.initial_backoff_seconds = initial_backoff_seconds
        self.max_backoff_seconds = max_backoff_seconds
        self._stop_event = threading.Event()
        self._wake_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        self._last_delivered_at: str | None = None
        self._last_error: str | None = None
        self._delivered = 0
        self._retries = 0

    @property
    def rejected_dir(self) -> Path:
        return self.outbox / "rejected"

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
            delivered, retries = self._delivered, self._retries
        return {
            "enabled": self.enabled,
            "pendingEvents": self.pending_count(),
            "rejectedEvents": sum(1 for _ in self.rejected_dir.glob("*.json")) if self.rejected_dir.exists() else 0,
            "deliveredEvents": delivered,
            "retries": retries,
            "lastDeliveredAt": last_delivered_at,
            "lastError": last_error,
        }

    def _next_event(self) -> Path | None:
        return next(iter(sorted(self.outbox.glob("*.json"))), None)

    def _run(self) -> None:
        backoff_seconds = self.initial_backoff_seconds
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
                    self._delivered += 1
                backoff_seconds = self.initial_backoff_seconds
            except HTTPError as exc:
                if exc.code in EVENT_REJECTED:
                    self._reject(path, exc.code)
                    continue
                backoff_seconds = self._back_off(f"HTTP_{exc.code}", backoff_seconds)
            except ValueError:
                # Unreadable file (e.g. truncated by a power cut): it can never be sent as is.
                self._reject(path, "INVALID_JSON")
            except (OSError, URLError) as exc:
                backoff_seconds = self._back_off(type(exc).__name__, backoff_seconds)
            if self._stop_event.is_set():
                return

    def _back_off(self, error: str, backoff_seconds: float) -> float:
        with self._lock:
            self._last_error = error
            self._retries += 1
        # Jitter keeps many nodes from retrying in lockstep when the central comes back.
        self._stop_event.wait(backoff_seconds * random.uniform(0.8, 1.2))
        return min(backoff_seconds * 2, self.max_backoff_seconds)

    def _reject(self, path: Path, reason: int | str) -> None:
        self.rejected_dir.mkdir(parents=True, exist_ok=True)
        path.replace(self.rejected_dir / f"{path.stem}.{reason}.json")
        with self._lock:
            self._last_error = f"REJECTED_{reason}"

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
