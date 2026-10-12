import unittest
from types import SimpleNamespace

import numpy as np

from vigia_vision.colors import MAX_CROPS_PER_FRAME, ColorVotes, classify_tracks, crop, prune
from vigia_vision.events import TrackState

NAMES = {0: "red", 1: "white"}


class FakeClassifier:
    def __init__(self, probabilities):
        self.probabilities = probabilities
        self.calls = []

    def predict(self, images, verbose=False):
        self.calls.append(images)
        return [
            SimpleNamespace(names=NAMES, probs=SimpleNamespace(data=SimpleNamespace(tolist=lambda: self.probabilities)))
            for _ in images
        ]


class ColorVotesTests(unittest.TestCase):
    def test_color_needs_two_clear_votes(self):
        votes = ColorVotes()
        votes.add({"red": 0.9, "white": 0.1}, now=0)
        self.assertIsNone(votes.color)
        votes.add({"red": 0.8, "white": 0.2}, now=1)
        self.assertEqual(votes.color, "red")

    def test_ambiguous_average_stays_unknown(self):
        votes = ColorVotes()
        votes.add({"red": 0.45, "white": 0.4, "gray": 0.15}, now=0)
        votes.add({"red": 0.4, "white": 0.45, "gray": 0.15}, now=1)
        self.assertIsNone(votes.color)

    def test_sampling_is_throttled_and_capped(self):
        votes = ColorVotes()
        self.assertTrue(votes.wants_sample(0))
        votes.add({"red": 1.0}, now=0)
        self.assertFalse(votes.wants_sample(0.2))
        self.assertTrue(votes.wants_sample(0.6))
        for step in range(1, 5):
            votes.add({"red": 1.0}, now=step)
        self.assertFalse(votes.wants_sample(100))


class ClassifyTracksTests(unittest.TestCase):
    def test_tiny_boxes_are_not_cropped(self):
        frame = np.zeros((100, 200, 3), dtype=np.uint8)
        self.assertIsNone(crop(frame, [10, 10, 30, 80]))
        self.assertEqual(crop(frame, [-5, 10, 50, 60]).shape, (50, 50, 3))

    def test_tracks_get_votes_with_fewest_votes_first_and_a_crop_limit(self):
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        boxes = {track_id: [0, 0, 100, 100] for track_id in range(1, 6)}
        votes = {1: ColorVotes(votes=1, last_at=-10)}
        model = FakeClassifier([0.9, 0.1])

        classify_tracks(model, frame, boxes, votes, now=0)

        self.assertEqual(len(model.calls[0]), MAX_CROPS_PER_FRAME)
        self.assertEqual(votes[1].votes, 1, "the track that already had a vote waits")
        self.assertEqual([votes[i].votes for i in (2, 3, 4)], [1, 1, 1])
        self.assertEqual(votes[2].sums, {"red": 0.9, "white": 0.1})

    def test_prune_drops_expired_tracks(self):
        votes = {1: ColorVotes(), 2: ColorVotes()}
        prune(votes, {2})
        self.assertEqual(list(votes), [2])

    def test_track_color_reaches_the_envelope(self):
        track = TrackState(3, "car", 0.9, "start", "end", (10, 10), (90, 20), [0, 0, 10, 10], color="white")
        self.assertEqual(track.public_dict()["color"], "white")


if __name__ == "__main__":
    unittest.main()
