import json
import tempfile
import unittest
from pathlib import Path

from training.build_plate_dataset import build_dataset
from training.import_roboflow_yolo import import_dataset
from training.prepare_video_frames import parse_range, timestamps


class TrainingToolsTests(unittest.TestCase):
    def test_temporal_ranges_are_parsed_and_end_is_exclusive(self):
        self.assertEqual(parse_range("10:21.5"), (10.0, 21.5))
        self.assertEqual(timestamps(10, 21, 5), [10, 15, 20])

    def test_dataset_builder_preserves_manifest_splits(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source_phone_02"
            images = source / "images" / "raw"
            labels = source / "labels" / "raw"
            images.mkdir(parents=True)
            labels.mkdir(parents=True)
            frames = []
            for index, split in enumerate(("train", "val", "test"), start=1):
                filename = f"frame-{index:06d}.jpg"
                (images / filename).write_bytes(b"image")
                (labels / f"frame-{index:06d}.txt").write_text("", encoding="utf-8")
                frames.append({"file": filename, "timestamp_seconds": index * 10, "split": split})
            (source / "manifest.json").write_text(
                json.dumps({"version": 1, "frames": frames}),
                encoding="utf-8",
            )

            output = root / "final"
            counts = build_dataset([], [source], output)

            self.assertEqual(counts, {"train": 1, "val": 1, "test": 1})
            self.assertTrue((output / "images" / "test" / "source_phone_02-frame-000003.jpg").is_file())
            self.assertIn("test: images/test", (output / "data.yaml").read_text(encoding="utf-8"))

    def test_roboflow_import_audits_and_normalizes_one_plate_class(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            export = root / "export"
            colors = {"train": "red", "valid": "green", "test": "blue"}
            for split in ("train", "valid", "test"):
                images = export / split / "images"
                labels = export / split / "labels"
                images.mkdir(parents=True)
                labels.mkdir(parents=True)
                from PIL import Image

                Image.new("RGB", (100, 50), colors[split]).save(images / f"{split}.jpg")
                (labels / f"{split}.txt").write_text("0 0.5 0.5 0.2 0.2\n", encoding="utf-8")
            (export / "data.yaml").write_text(
                "train: train/images\nval: valid/images\ntest: test/images\nnames: [Placa]\n",
                encoding="utf-8",
            )

            output = root / "imported"
            audit = import_dataset(export, output)

            self.assertEqual(audit["counts"], {"train": 1, "val": 1, "test": 1})
            self.assertEqual(audit["boxes"], 3)
            self.assertEqual(audit["plate_width_px"]["median"], 20.0)
            self.assertEqual(audit["plate_width_ratio"]["median"], 0.2)
            self.assertEqual(audit["tight_crop_images"], 0)
            self.assertEqual(audit["warnings"], [])
            self.assertTrue((output / "labels" / "val" / "val-valid.txt").is_file())


if __name__ == "__main__":
    unittest.main()
