"""Recortes del nodo PC: la mejor vista por track, después de su sobre y nunca guardada al fallar."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import time
import unittest
from urllib.parse import parse_qs, urlparse

import cv2
import numpy as np

from vigia_vision.publisher import SnapshotPublisher
from vigia_vision.thumbnails import MAX_SIDE_PX, ThumbnailCollector, encode_crop

FRAME = np.full((720, 1280, 3), 90, dtype=np.uint8)


class CollectorTests(unittest.TestCase):
    def test_crop_keeps_only_the_vehicle_scaled_down_as_jpeg(self):
        jpeg = encode_crop(FRAME, [100, 100, 700, 400], cv2)
        image = cv2.imdecode(np.frombuffer(jpeg, np.uint8), cv2.IMREAD_COLOR)
        self.assertEqual(max(image.shape[:2]), MAX_SIDE_PX)
        self.assertLess(len(jpeg), 64 * 1024)
        self.assertIsNone(encode_crop(FRAME, [10, 10, 30, 30], cv2))  # Too small to judge.

    def test_keeps_the_largest_view_and_sends_once_when_the_vehicle_leaves(self):
        collector = ThumbnailCollector()
        collector.observe(FRAME, {7: [100, 100, 200, 180]}, 0.0, cv2)
        first = collector._captures[7].jpeg
        collector.observe(FRAME, {7: [100, 100, 205, 182]}, 0.1, cv2)  # Under 20 % growth: kept.
        self.assertIs(collector._captures[7].jpeg, first)
        collector.observe(FRAME, {7: [100, 100, 300, 260]}, 0.2, cv2)
        self.assertEqual(collector._captures[7].takes, 2)
        self.assertEqual(collector.due({7: 0.2}, {7}, 0.5), [])  # Still in view.
        self.assertEqual(collector.due({7: 0.2}, set(), 1.5), [])  # Not in an envelope yet.
        ready = collector.due({7: 0.2}, {7}, 1.5)
        self.assertEqual([track for track, _ in ready], [7])
        collector.observe(FRAME, {7: [0, 0, 900, 700]}, 1.6, cv2)
        self.assertEqual(collector.due({7: 1.6}, {7}, 5.0, flush=True), [])  # Only once per track.

    def test_parked_vehicle_is_sent_after_ten_seconds_and_unpublished_ones_are_forgotten(self):
        collector = ThumbnailCollector()
        collector.observe(FRAME, {1: [100, 100, 200, 180], 2: [400, 100, 500, 180]}, 0.0, cv2)
        self.assertEqual([t for t, _ in collector.due({1: 10.5, 2: 10.5}, {1}, 10.5)], [1])
        self.assertEqual(collector.due({}, set(), 11.0), [])
        self.assertNotIn(2, collector._captures)


class Central:
    """Responde a sobres y recortes con los códigos programados."""

    def __init__(self, thumbnail_codes: list[int]):
        self.codes = thumbnail_codes
        self.order: list[str] = []
        central = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - stdlib API
                body = self.rfile.read(int(self.headers["Content-Length"]))
                url = urlparse(self.path)
                if url.path.endswith("/thumbnails"):
                    query = parse_qs(url.query)
                    is_jpeg = body[:3] == b"\xff\xd8\xff"
                    central.order.append(f"t{query['trackId'][0]}:{self.headers['Content-Type']}:{is_jpeg}")
                    code = central.codes.pop(0) if central.codes else 201
                else:
                    central.order.append(json.loads(body)["eventId"])
                    code = 202
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


def wait_until(condition, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


class PublisherThumbnailTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.outbox = Path(self.directory.name)
        self.jpeg = encode_crop(FRAME, [100, 100, 300, 260], cv2)

    def tearDown(self):
        self.directory.cleanup()

    def publisher(self, central):
        publisher = SnapshotPublisher(central.url, "token", self.outbox, timeout_seconds=2,
                                      initial_backoff_seconds=0.02, max_backoff_seconds=0.05)
        self.addCleanup(publisher.stop)
        return publisher

    def test_recorte_follows_its_envelope_and_failures_never_keep_the_image(self):
        central = Central([404, 503, 201])
        self.addCleanup(central.close)
        publisher = self.publisher(central)
        self.assertFalse(publisher.enqueue_thumbnail("CAM-01", "s", 1, "t", self.jpeg))  # No envelope yet.
        publisher.enqueue({"eventId": "e1", "sequenceNumber": 1, "detections": []})
        publisher.enqueue_thumbnail("CAM-01", "s", 1, "2026-11-02T10:00:00.000+00:00", self.jpeg)
        publisher.enqueue_thumbnail("CAM-01", "s", 2, "2026-11-02T10:00:01.000+00:00", self.jpeg)
        publisher.enqueue({"eventId": "e2", "sequenceNumber": 2, "detections": []})
        publisher.start()
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        # 404 drops track 1; 503 retries track 2 until it is stored.
        self.assertEqual(central.order, ["e1", "t1:image/jpeg:True", "t2:image/jpeg:True", "t2:image/jpeg:True", "e2"])
        self.assertEqual(publisher.status()["thumbnails"]["dropped"], 1)
        self.assertEqual(publisher.status()["thumbnails"]["sent"], 1)
        self.assertFalse((self.outbox / "rejected").exists())

    def test_central_without_storage_turns_recortes_off_for_the_session(self):
        central = Central([501])
        self.addCleanup(central.close)
        publisher = self.publisher(central)
        publisher.enqueue({"eventId": "e1", "sequenceNumber": 1, "detections": []})
        publisher.enqueue_thumbnail("CAM-01", "s", 1, "t", self.jpeg)
        publisher.start()
        self.assertTrue(wait_until(lambda: publisher.pending_count() == 0))
        self.assertFalse(publisher.status()["thumbnails"]["enabled"])
        self.assertFalse(publisher.enqueue_thumbnail("CAM-01", "s", 2, "t", self.jpeg))
