import unittest

import numpy as np

from vigia_vision.events import TrackState
from vigia_vision.plate_ocr import (
    MAX_READS,
    MAX_READS_PER_FRAME,
    MIN_PLATE_WIDTH_PX,
    PlateReads,
    decode,
    prune,
    read_tracks,
    valid_plate,
)
from vigia_vision.plates import PlateDetection

ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_"


def one_hot(text: str, slots: int = 10, confidence: float = 0.9) -> np.ndarray:
    output = np.full((slots, len(ALPHABET)), (1 - confidence) / (len(ALPHABET) - 1))
    for slot, char in enumerate(text.ljust(slots, "_")):
        output[slot, ALPHABET.index(char)] = confidence
    return output.reshape(1, -1)


class FakeReader:
    def __init__(self, reads):
        self.reads = list(reads)
        self.calls = []

    def read(self, plates):
        self.calls.append(plates)
        return [self.reads.pop(0) for _ in plates]


def plate(track_id, x1=100, width=60, confidence=0.9):
    return PlateDetection(track_id=track_id, confidence=confidence, bounding_box=(x1, 100, x1 + width, 120))


class DecodeTests(unittest.TestCase):
    def test_padding_is_removed_and_confidence_is_the_weakest_character(self):
        output = one_hot("ABC123")
        output.reshape(10, -1)[2] = 0.0
        output.reshape(10, -1)[2, ALPHABET.index("C")] = 0.4
        self.assertEqual(decode(output, ALPHABET, 10, "_"), [("ABC123", 0.4)])

    def test_colombian_formats(self):
        for text in ("ABC123", "ABC12D", "ABC12"):
            self.assertTrue(valid_plate(text), text)
        for text in ("AB123", "ABC1234", "123ABC", ""):
            self.assertFalse(valid_plate(text), text)


class PlateReadsTests(unittest.TestCase):
    def test_a_plate_needs_two_matching_reads(self):
        reads = PlateReads()
        reads.add("ABC123")
        self.assertIsNone(reads.plate)
        reads.add(None)
        reads.add("ABC123")
        self.assertEqual(reads.plate, "ABC123")

    def test_a_tie_stays_unknown(self):
        reads = PlateReads()
        for text in ("ABC123", "ABC128", "ABC123", "ABC128"):
            reads.add(text)
        self.assertIsNone(reads.plate)

    def test_reads_are_capped(self):
        reads = PlateReads()
        for _ in range(MAX_READS):
            self.assertTrue(reads.wants_read())
            reads.add(None)
        self.assertFalse(reads.wants_read())


class ReadTracksTests(unittest.TestCase):
    def setUp(self):
        self.frame = np.zeros((480, 640, 3), dtype=np.uint8)

    def test_small_plates_and_invalid_reads_do_not_vote(self):
        reads = {}
        reader = FakeReader([("ABC123", 0.9), ("XY1", 0.9), ("DEF456", 0.2)])
        detections = [plate(1), plate(2, x1=300), plate(3, x1=500, width=MIN_PLATE_WIDTH_PX - 1), plate(4, x1=400)]
        read_tracks(reader, self.frame, detections, reads)
        self.assertEqual(len(reader.calls[0]), 3)  # Track 3's plate is too small to read.
        self.assertEqual(reads[1].texts["ABC123"], 1)
        self.assertEqual((reads[2].reads, sum(reads[2].texts.values())), (1, 0))  # Not a plate format.
        self.assertEqual((reads[4].reads, sum(reads[4].texts.values())), (1, 0))  # Too unsure.

    def test_best_plate_per_track_and_shared_plates_are_skipped(self):
        reads = {}
        reader = FakeReader([("ABC123", 0.9)])
        detections = [
            plate(1, x1=100, confidence=0.6),
            plate(1, x1=200, confidence=0.9),  # Same vehicle, better box: this one is read.
            plate(2, x1=400),
            plate(3, x1=402),  # Overlapping vehicles see the same plate: it belongs to neither.
        ]
        read_tracks(reader, self.frame, detections, reads)
        self.assertEqual(len(reader.calls), 1)
        self.assertEqual(reader.calls[0][0].shape, (20, 60, 3))
        self.assertEqual(set(reads), {1})

    def test_reads_per_frame_are_limited_and_fewest_reads_go_first(self):
        reads = {1: PlateReads(reads=3)}
        reader = FakeReader([("ABC123", 0.9)] * MAX_READS_PER_FRAME)
        read_tracks(reader, self.frame, [plate(track_id, x1=track_id * 70) for track_id in range(1, 6)], reads)
        self.assertEqual(len(reader.calls[0]), MAX_READS_PER_FRAME)
        self.assertEqual(reads[1].reads, 3)

    def test_prune_and_snapshot_carry_the_plate(self):
        reads = {1: PlateReads(), 2: PlateReads()}
        prune(reads, {2})
        self.assertEqual(set(reads), {2})
        track = TrackState(1, "car", 0.9, "t0", "t1", (0, 0), (0, 0), [0, 0, 1, 1], license_plate="ABC123")
        self.assertEqual(track.public_dict()["licensePlate"], "ABC123")


if __name__ == "__main__":
    unittest.main()
