import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from vigia_vision.config import Settings
from vigia_vision.events import TrackState, build_snapshot
from vigia_vision.plates import plate_class_ids
from vigia_vision.runtime import VisionRuntime
from vigia_vision.publisher import SnapshotPublisher


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

    @patch.dict(os.environ, {"VIDEO_SOURCE_URL": "http://127.0.0.1:8080/video", "TAPO_HOST": "192.168.1.50"}, clear=True)
    def test_generic_video_source_takes_precedence_over_tapo(self):
        settings = Settings.from_environment()
        self.assertEqual(settings.source_url(), "http://127.0.0.1:8080/video")

    @patch.dict(os.environ, {}, clear=True)
    @patch("vigia_vision.config.load_dotenv")  # Ignore the developer's real .env.
    def test_without_generic_source_the_tapo_is_required(self, _load_dotenv):
        with self.assertRaises(ValueError):
            Settings.from_environment().source_url()

    @patch.dict(os.environ, {"VIDEO_SOURCE_URL": "/dev/video2"}, clear=True)
    def test_phone_in_usb_webcam_mode_is_a_local_camera(self):
        self.assertEqual(Settings.from_environment().source_url(), "/dev/video2")

    @patch.dict(os.environ, {"VIDEO_SOURCE_URL": "/dev/sda"}, clear=True)
    def test_only_video_devices_are_accepted_as_local_paths(self):
        with self.assertRaises(ValueError):
            Settings.from_environment()

    @patch.dict(os.environ, {"VIDEO_SOURCE_URL": "file:///etc/passwd"}, clear=True)
    def test_video_source_rejects_unexpected_schemes(self):
        with self.assertRaises(ValueError):
            Settings.from_environment()

    def test_each_node_can_load_its_own_env_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env_file = Path(directory) / "cel-01.env"
            env_file.write_text("VIGIA_CAMERA_ID=CEL-01\nCAMERA_MODEL=OPPO CPH2599\nVIDEO_SOURCE_URL=http://127.0.0.1:8081/video\n")
            with patch.dict(os.environ, {"VIGIA_ENV_FILE": str(env_file)}, clear=True):
                settings = Settings.from_environment()
        self.assertEqual((settings.camera_id, settings.camera_model), ("CEL-01", "OPPO CPH2599"))
        self.assertEqual(settings.source_url(), "http://127.0.0.1:8081/video")

    def test_direction_uses_largest_displacement(self):
        track = TrackState(1, "car", 0.9, "start", "end", (10, 10), (90, 20), [0, 0, 10, 10])
        self.assertEqual(track.direction, "izquierda-a-derecha")

    def test_detection_snapshot_uses_public_contract(self):
        track = TrackState(7, "car", 0.91, "start", "end", (10, 10), (90, 20), [1, 2, 3, 4])

        snapshot = build_snapshot("CAM-01", "yolo11n.pt", 42, {track.track_id: track})

        self.assertEqual(snapshot["schemaVersion"], "1.1")
        self.assertTrue(snapshot["eventId"])
        self.assertTrue(snapshot["sessionId"])
        self.assertEqual(snapshot["sequenceNumber"], 42)
        self.assertEqual(snapshot["cameraId"], "CAM-01")
        self.assertEqual(snapshot["frameNumber"], 42)
        self.assertEqual(snapshot["detections"][0]["trackId"], 7)
        self.assertNotIn("first_center", snapshot["detections"][0])

    def test_publisher_persists_envelopes_before_delivery(self):
        with tempfile.TemporaryDirectory() as directory:
            publisher = SnapshotPublisher("https://vigia-central.example.ts.net", "secret", Path(directory))
            payload = build_snapshot("CAM-01", "yolo26n.pt", 42, {})

            self.assertTrue(publisher.enqueue(payload))
            self.assertEqual(publisher.pending_count(), 1)
            stored = publisher._next_event()
            self.assertIsNotNone(stored)
            self.assertIn(payload["eventId"], stored.name)

    def test_mjpeg_stream_wraps_latest_frame(self):
        settings = Settings.from_environment()
        runtime = VisionRuntime(settings)
        with runtime._frame_condition:
            runtime._latest_jpeg = b"jpeg-data"
            runtime._preview_version = 1

        stream = runtime.mjpeg_stream()
        chunk = next(stream)
        stream.close()

        self.assertTrue(chunk.startswith(b"--frame\r\nContent-Type: image/jpeg"))
        self.assertIn(b"Content-Length: 9", chunk)
        self.assertTrue(chunk.endswith(b"jpeg-data\r\n"))

    def test_plate_detector_accepts_english_and_spanish_class_names(self):
        english_model = type("Model", (), {"names": {0: "license_plate", 1: "vehicle"}})()
        spanish_model = type("Model", (), {"names": ["placa", "automovil"]})()

        self.assertEqual(plate_class_ids(english_model), [0])
        self.assertEqual(plate_class_ids(spanish_model), [0])


if __name__ == "__main__":
    unittest.main()
