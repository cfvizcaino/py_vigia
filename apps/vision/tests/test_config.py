import os
import unittest
from unittest.mock import patch

from vigia_vision.config import Settings
from vigia_vision.events import TrackState, build_snapshot


class SettingsTests(unittest.TestCase):
    @patch.dict(
        os.environ,
        {
            "TAPO_HOST": "192.168.1.50",
            "TAPO_USERNAME": "usuario correo",
            "TAPO_PASSWORD": "clave@segura",
            "TAPO_STREAM": "stream2",
        },
        clear=True,
    )
    def test_rtsp_credentials_are_encoded(self):
        url = Settings.from_environment().rtsp_url()
        self.assertEqual(url, "rtsp://usuario%20correo:clave%40segura@192.168.1.50:554/stream2")

    def test_direction_uses_largest_displacement(self):
        track = TrackState(1, "car", 0.9, "start", "end", (10, 10), (90, 20), [0, 0, 10, 10])
        self.assertEqual(track.direction, "izquierda-a-derecha")

    def test_detection_snapshot_uses_public_contract(self):
        track = TrackState(7, "car", 0.91, "start", "end", (10, 10), (90, 20), [1, 2, 3, 4])

        snapshot = build_snapshot("CAM-01", "yolo11n.pt", 42, {track.track_id: track})

        self.assertEqual(snapshot["schemaVersion"], "1.0")
        self.assertEqual(snapshot["cameraId"], "CAM-01")
        self.assertEqual(snapshot["frameNumber"], 42)
        self.assertEqual(snapshot["detections"][0]["trackId"], 7)
        self.assertNotIn("first_center", snapshot["detections"][0])


if __name__ == "__main__":
    unittest.main()
