"""La cola edge no se bloquea con un evento rechazado y nunca descarta por fallas transitorias."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

from vigia_vision import publisher as publisher_module
from vigia_vision.publisher import SnapshotPublisher


class Central:
    """Servidor HTTP mínimo: responde el código programado para cada eventId."""

    def __init__(self, codes: dict[str, list[int]]):
        self.codes = codes
        self.received: list[str] = []
        central = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - stdlib API
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                central.received.append(body["eventId"])
                queue = central.codes.get(body["eventId"], [])
                code = queue.pop(0) if queue else 202
                self.send_response(code)
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def event(sequence: int) -> dict:
    return {"eventId": f"e{sequence}", "sequenceNumber": sequence, "detections": []}


def wait_until(condition, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.outbox = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def run_publisher(self, central: Central, events: list[dict]) -> SnapshotPublisher:
        # Fast retries for the test; production starts at 1 s and caps at 30 s.
        publisher = SnapshotPublisher(central.url, "token", self.outbox, timeout_seconds=2,
                                      initial_backoff_seconds=0.02, max_backoff_seconds=0.05)
        for item in events:
            publisher.enqueue(item)
        publisher.start()
        self.addCleanup(publisher.stop)
        return publisher

    def test_rejected_event_is_set_aside_and_later_events_still_flow(self):
        central = Central({"e2": [409] * 100})  # Permanent: the old publisher retried it forever.
        self.addCleanup(central.close)
        publisher = self.run_publisher(central, [event(1), event(2), event(3)])
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        rejected = list((self.outbox / "rejected").glob("*.json"))
        self.assertEqual([path.name.split(".")[-2] for path in rejected], ["409"])
        self.assertEqual(central.received, ["e1", "e2", "e3"])
        self.assertEqual(publisher.status()["rejectedEvents"], 1)

    def test_transient_failures_keep_order_and_never_drop(self):
        central = Central({"e1": [503, 503, 500]})
        self.addCleanup(central.close)
        publisher = self.run_publisher(central, [event(1), event(2)])
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        self.assertEqual(central.received, ["e1", "e1", "e1", "e1", "e2"])
        self.assertFalse((self.outbox / "rejected").exists())
        self.assertEqual(publisher.status()["retries"], 3)

    def test_node_level_errors_retry_instead_of_discarding(self):
        central = Central({"e1": [401, 403, 404]})
        self.addCleanup(central.close)
        publisher = self.run_publisher(central, [event(1)])
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        self.assertEqual(central.received.count("e1"), 4)
        self.assertFalse((self.outbox / "rejected").exists())

    def test_unreachable_central_keeps_events_on_disk(self):
        central = Central({})
        url = central.url
        central.close()
        publisher = SnapshotPublisher(url, "token", self.outbox, timeout_seconds=0.5,
                                      initial_backoff_seconds=0.02, max_backoff_seconds=0.05)
        publisher.enqueue(event(1))
        publisher.start()
        self.addCleanup(publisher.stop)
        self.assertTrue(wait_until(lambda: publisher.status()["retries"] >= 2))
        self.assertEqual(publisher.pending_count(), 1)

    def test_corrupt_file_does_not_block_the_queue(self):
        central = Central({})
        self.addCleanup(central.close)
        (self.outbox / f"{0:020d}-broken.json").write_text("{truncated", encoding="utf-8")
        publisher = self.run_publisher(central, [event(1)])
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        self.assertEqual(central.received, ["e1"])
        self.assertTrue(any(p.name.endswith("INVALID_JSON.json") for p in (self.outbox / "rejected").iterdir()))

    def test_backoff_grows_with_jitter_and_is_capped(self):
        publisher = SnapshotPublisher("http://127.0.0.1:9", None, self.outbox)
        delays = []
        with patch.object(publisher._stop_event, "wait", side_effect=delays.append):
            backoff = publisher.initial_backoff_seconds
            for _ in range(8):
                backoff = publisher._back_off("URLError", backoff)
        self.assertGreaterEqual(delays[0], 0.8)
        self.assertLessEqual(max(delays), publisher_module.MAX_BACKOFF_SECONDS * 1.2)
        self.assertEqual(backoff, publisher_module.MAX_BACKOFF_SECONDS)
        self.assertEqual(publisher.status()["retries"], 8)


if __name__ == "__main__":
    unittest.main()
