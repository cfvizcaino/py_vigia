import json
import tempfile
import unittest
from pathlib import Path

from training.build_color_dataset import build_dataset as build_color_dataset
from training.build_plate_crops import build as build_plate_crops
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

    def test_color_dataset_unifies_names_dedupes_and_splits_every_class(self):
        from PIL import Image

        from training.build_color_dataset import VIGIA_COLORS

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            folders = {color: color for color in VIGIA_COLORS} | {"gray": "Grey", "pink": "pink"}
            for index, (color, folder) in enumerate(folders.items()):
                (source / folder).mkdir(parents=True)
                for shade in range(5):
                    Image.new("RGB", (40, 30), (shade * 40, index * 25, 9)).save(source / folder / f"{shade}.jpg")
            red = list(folders).index("red")
            Image.new("RGB", (40, 30), (0, red * 25, 9)).save(source / "red" / "copy.jpg")  # same bytes as red/0
            Image.new("RGB", (10, 30), "white").save(source / "white" / "tiny.jpg")

            summary = build_color_dataset([source], root / "colors")

            for split in ("train", "val", "test"):
                self.assertEqual(set(summary["counts"][split]), set(VIGIA_COLORS))
            self.assertEqual(sum(summary["counts"][s]["gray"] for s in ("train", "val", "test")), 5)
            self.assertEqual(summary["skipped"], {"color:pink": 5, "diminuta": 1, "duplicada": 1})
            self.assertTrue(any((root / "colors" / "test" / "gray").iterdir()))

    def test_color_dataset_keeps_the_splits_a_source_brings(self):
        from PIL import Image

        from training.build_color_dataset import VIGIA_COLORS

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            flat, site = root / "flat", root / "site"
            for index, color in enumerate(VIGIA_COLORS):
                (flat / color).mkdir(parents=True)
                for shade in range(3):
                    Image.new("RGB", (40, 30), (shade * 40, index * 25, 9)).save(flat / color / f"{shade}.jpg")
            for split, shade in (("train", 200), ("test", 220)):
                (site / split / "gray").mkdir(parents=True)
                Image.new("RGB", (40, 30), (shade, 9, 9)).save(site / split / "gray" / "car.jpg")

            summary = build_color_dataset([flat, site], root / "colors")

            self.assertEqual(
                [summary["counts"][split]["gray"] for split in ("train", "val", "test")], [1 + 1, 1, 1 + 1]
            )

    def test_plate_crops_follow_inference_and_skip_ambiguous_vehicles(self):
        from PIL import Image

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "source"
            (source / "images" / "raw").mkdir(parents=True)
            (source / "labels" / "raw").mkdir(parents=True)
            frames, vehicles = [], {}
            for index, split in enumerate(("train", "val", "test"), start=1):
                name = f"frame-{index:06d}.jpg"
                Image.new("RGB", (1000, 600), "gray").save(source / "images" / "raw" / name)
                # Plate 40×20 px at (500, 300) in frame coordinates; a second one at (900, 300).
                (source / "labels" / "raw" / f"frame-{index:06d}.txt").write_text(
                    "0 0.5 0.5 0.04 0.0333333\n0 0.9 0.5 0.04 0.0333333\n", encoding="utf-8")
                vehicles[name] = [
                    {"box": [400, 200, 600, 400]},  # Contains the first plate: kept with a label.
                    {"box": [0, 200, 200, 400]},  # Touches the frame edge: skipped.
                    {"box": [700, 200, 890, 400]},  # Would cut the second plate in half: skipped.
                    {"box": [200, 450, 380, 580]},  # No plate: kept as a negative.
                ]
                frames.append({"file": name, "timestamp_seconds": index, "split": split})
            (source / "vehicles.json").write_text(json.dumps(vehicles), encoding="utf-8")
            (source / "manifest.json").write_text(json.dumps({"version": 1, "frames": frames}), encoding="utf-8")

            summary = build_plate_crops([source], root / "crops", min_vehicle=150, edge=4)

            self.assertEqual(summary["crops"], {"train": 2, "val": 2, "test": 2})
            self.assertEqual(summary["skipped"], {"toca el borde": 3, "cortaría una placa": 3})
            label = (root / "crops" / "labels" / "train" / "source-frame-000001-v00.txt").read_text().split()
            # Crop: 400±8, 200±8 → plate centre (500, 300) is the crop centre; 40 px of a 216 px crop.
            self.assertAlmostEqual(float(label[1]), 0.5, places=3)
            self.assertAlmostEqual(float(label[3]), 40 / 216, places=3)
            self.assertEqual((root / "crops" / "labels" / "train" / "source-frame-000001-v03.txt").read_text(), "")


if __name__ == "__main__":
    unittest.main()
