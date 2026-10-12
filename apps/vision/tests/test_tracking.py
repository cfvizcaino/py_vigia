import os
import unittest
from pathlib import Path
from unittest import mock

import yaml

from training.evaluate_tracking import metrics
from vigia_vision.config import Settings
from vigia_vision.events import DETECTOR_FLOOR, publishable, update_tracks


class _Tensor:
    def __init__(self, values):
        self.values = values

    def cpu(self):
        return self

    def int(self):
        return self

    def tolist(self):
        return self.values


def _result(track_id: int, score: float, box=(10, 10, 60, 40)):
    boxes = type("Boxes", (), {})()
    boxes.xyxy = _Tensor([list(box)])
    boxes.cls = _Tensor([2])
    boxes.conf = _Tensor([score])
    boxes.id = _Tensor([track_id])
    return type("Result", (), {"boxes": boxes})()


class TrackingTests(unittest.TestCase):
    def test_weak_detections_keep_the_best_confidence_and_publication_filters(self):
        tracks, seen = {}, {}
        update_tracks(_result(4, 0.62), tracks, seen, 0.0, 20)
        update_tracks(_result(4, 0.14), tracks, seen, 0.2, 20)  # ByteTrack's second stage
        update_tracks(_result(5, 0.2), tracks, seen, 0.2, 20)
        self.assertEqual(tracks[4].confidence, 0.62)
        self.assertEqual(list(publishable(tracks, 0.35)), [4])

    def test_default_tracker_receives_weak_detections_and_creates_like_before(self):
        with mock.patch.dict(os.environ, {"VIGIA_ENV_FILE": os.devnull}, clear=True):
            settings = Settings.from_environment()
        config = yaml.safe_load(Path(settings.tracker).read_text(encoding="utf-8"))
        self.assertEqual(config["tracker_type"], "bytetrack")
        self.assertEqual(config["track_low_thresh"], DETECTOR_FLOOR)
        # New vehicles need the publishing confidence, so coverage does not drop.
        self.assertEqual(config["new_track_thresh"], settings.confidence)
        self.assertEqual(config["track_high_thresh"], settings.confidence)
        self.assertGreaterEqual(config["track_buffer"], 60)

    def test_fragment_metric_counts_a_vehicle_recreated_in_place(self):
        car = [10, 10, 60, 40]
        tracks = [
            {"id": 1, "label": "car", "first": 0, "last": 3, "firstBox": car, "lastBox": car},
            {"id": 2, "label": "car", "first": 4, "last": 9, "firstBox": car, "lastBox": car},
            {"id": 3, "label": "car", "first": 4, "last": 9, "firstBox": [400, 10, 450, 40], "lastBox": car},
            {"id": 4, "label": "motorcycle", "first": 4, "last": 5, "firstBox": car, "lastBox": car},
        ]
        result = metrics(tracks)
        self.assertEqual(result["fragmentos"], 1)
        self.assertEqual(result["tracks_sin_fragmentos"], 3)


if __name__ == "__main__":
    unittest.main()
