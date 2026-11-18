"""El nodo PC avisa al centro que sigue procesando y cuándo se detiene."""

from __future__ import annotations

from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import threading
import time
import unittest

from vigia_vision.heartbeat import HeartbeatSender


class Central:
    def __init__(self, code: int = 200):
        self.received: list[dict] = []
        self.tokens: list[str | None] = []
        central = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802 - stdlib API
                central.received.append(json.loads(self.rfile.read(int(self.headers["Content-Length"]))))
                central.tokens.append(self.headers.get("X-Vigia-Device-Token"))
                self.send_response(code)
                self.end_headers()

            def log_message(self, *args):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()


class HeartbeatTests(unittest.TestCase):
    def test_running_beats_then_stopped_with_reading(self):
        central = Central()
        self.addCleanup(central.close)
        sender = HeartbeatSender(central.url, "secreto", "PC-01", "s-1", "0.3.0",
                                 lambda: {"analysesPerSecond": 9.5, "pendingEvents": 2, "lastError": None},
                                 interval_seconds=0.05)
        sender.start()
        deadline = time.monotonic() + 3
        while len(central.received) < 2 and time.monotonic() < deadline:
            time.sleep(0.01)
        sender.stop()
        states = [body["state"] for body in central.received]
        self.assertGreaterEqual(states.count("running"), 2)
        self.assertEqual(states[-1], "stopped")
        first = central.received[0]
        self.assertEqual(first["cameraId"], "PC-01")
        self.assertEqual(first["platform"], "pc")
        self.assertEqual(first["analysesPerSecond"], 9.5)
        self.assertNotIn("lastError", first)
        self.assertEqual(set(central.tokens), {"secreto"})

    def test_failures_are_counted_not_raised(self):
        central = Central(code=503)
        self.addCleanup(central.close)
        sender = HeartbeatSender(central.url, None, "PC-01", "s-1", "0.3.0", lambda: 1 / 0)
        self.assertFalse(sender.send("running"))
        self.assertEqual(sender.failed, 1)
        unreachable = HeartbeatSender("http://127.0.0.1:9", None, "PC-01", "s-1", "0.3.0", dict, timeout_seconds=0.5)
        self.assertFalse(unreachable.send("running"))

    def test_without_central_it_does_nothing(self):
        sender = HeartbeatSender(None, None, "PC-01", "s-1", "0.3.0", dict)
        sender.start()
        sender.stop()
        self.assertEqual((sender.sent, sender.failed), (0, 0))


if __name__ == "__main__":
    unittest.main()
