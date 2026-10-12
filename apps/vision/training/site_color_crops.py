"""Recortes de vehículos de videos propios para ajustar el clasificador de color.

1. ``extract``: detecta y sigue vehículos, guarda hasta N recortes por track y una
   etiqueta propuesta por el clasificador actual. Los tracks del último 30 % de cada
   video van a ``test`` (vehículos que el modelo no ve al entrenar).
2. Se revisan las propuestas y se corrigen en ``labels.json`` (track → color, o
   ``null`` para descartar un track dudoso).
3. ``build``: copia los recortes a ``<salida>/<split>/<color>/``, que
   build_color_dataset.py incorpora respetando esos splits.

  .venv/bin/python training/site_color_crops.py extract captures/*.mp4 --output datasets/colors/site-v1
  .venv/bin/python training/site_color_crops.py build datasets/colors/site-v1 --output datasets/colors/site-v1-labeled
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path

MIN_SIDE_PX = 32


def slug(path: Path) -> str:
    return re.sub(r"[^a-zA-Z0-9]+", "-", path.stem).strip("-").lower()[:40] or "video"


def extract(videos: list[Path], output: Path, *, colors_model: str, every: int, crops_per_track: int,
            test_fraction: float, max_frames: int | None) -> dict:
    import cv2
    from ultralytics import YOLO

    output.mkdir(parents=True, exist_ok=True)
    classifier = YOLO(colors_model, task="classify")
    tracks: dict[str, dict] = {}
    for video in videos:
        detector = YOLO("yolo26n.pt")  # Fresh tracker state per video.
        capture = cv2.VideoCapture(str(video))
        total = int(capture.get(cv2.CAP_PROP_FRAME_COUNT)) or 0
        split_at = int(total * (1 - test_fraction)) if total else None
        name = slug(video)
        frame_number = 0
        while True:
            ok, frame = capture.read()
            if not ok or (max_frames and frame_number >= max_frames):
                break
            frame_number += 1
            if frame_number % every:
                continue
            result = detector.track(frame, persist=True, tracker="bytetrack.yaml", classes=[2, 3],
                                    conf=0.35, verbose=False)[0]
            if result.boxes is None or result.boxes.id is None:
                continue
            for xyxy, track_id, class_id in zip(result.boxes.xyxy.int().tolist(), result.boxes.id.int().tolist(),
                                                result.boxes.cls.int().tolist(), strict=True):
                key = f"{name}-t{track_id}"
                track = tracks.setdefault(key, {
                    "video": video.name, "vehicle": {2: "car", 3: "motorcycle"}[class_id],
                    "first_frame": frame_number, "crops": [], "last_crop_frame": -10**9,
                })
                x1, y1, x2, y2 = xyxy
                spaced = frame_number - track["last_crop_frame"] >= every * 4
                if len(track["crops"]) >= crops_per_track or not spaced or min(x2 - x1, y2 - y1) < MIN_SIDE_PX:
                    continue
                file = f"{key}-{len(track['crops'])}.jpg"
                cv2.imwrite(str(output / file), frame[y1:y2, x1:x2], [cv2.IMWRITE_JPEG_QUALITY, 92])
                track["crops"].append(file)
                track["last_crop_frame"] = frame_number
        capture.release()
        for key, track in tracks.items():
            if key.startswith(f"{name}-t") and "split" not in track:
                track["split"] = "test" if split_at and track["first_frame"] >= split_at else "train"

    for track in tracks.values():
        track.pop("last_crop_frame", None)
        if not track["crops"]:
            continue
        sums: dict[str, float] = {}
        for result in classifier.predict([str(output / file) for file in track["crops"]], verbose=False):
            for index, value in enumerate(result.probs.data.tolist()):
                sums[result.names[index]] = sums.get(result.names[index], 0.0) + value
        best = max(sums, key=sums.get)
        track["proposed"] = best
        track["proposed_confidence"] = round(sums[best] / len(track["crops"]), 3)
    kept = {key: track for key, track in tracks.items() if track["crops"]}
    (output / "tracks.json").write_text(json.dumps(kept, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    labels = output / "labels.json"
    if not labels.exists():
        labels.write_text(json.dumps({key: track["proposed"] for key, track in kept.items()}, indent=2) + "\n",
                          encoding="utf-8")
    return kept


def build(source: Path, output: Path) -> dict[str, dict[str, int]]:
    if output.exists():
        raise FileExistsError(f"El destino ya existe: {output}")
    tracks = json.loads((source / "tracks.json").read_text(encoding="utf-8"))
    labels = json.loads((source / "labels.json").read_text(encoding="utf-8"))
    counts: dict[str, dict[str, int]] = {}
    for key, color in labels.items():
        if color is None or key not in tracks:
            continue
        split = tracks[key]["split"]
        target = output / split / color
        target.mkdir(parents=True, exist_ok=True)
        for file in tracks[key]["crops"]:
            shutil.copy2(source / file, target / file)
        counts.setdefault(split, {}).setdefault(color, 0)
        counts[split][color] += len(tracks[key]["crops"])
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    extract_parser = commands.add_parser("extract")
    extract_parser.add_argument("videos", nargs="+", type=Path)
    extract_parser.add_argument("--output", required=True, type=Path)
    extract_parser.add_argument("--colors-model", default="models/vehicle-colors.pt")
    extract_parser.add_argument("--every", type=int, default=2, help="Analiza 1 de cada N cuadros")
    extract_parser.add_argument("--crops-per-track", type=int, default=3)
    extract_parser.add_argument("--test-fraction", type=float, default=0.3)
    extract_parser.add_argument("--max-frames", type=int)
    build_parser = commands.add_parser("build")
    build_parser.add_argument("source", type=Path)
    build_parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.command == "extract":
        tracks = extract(args.videos, args.output, colors_model=args.colors_model, every=args.every,
                         crops_per_track=args.crops_per_track, test_fraction=args.test_fraction,
                         max_frames=args.max_frames)
        splits = [track["split"] for track in tracks.values()]
        print(json.dumps({"tracks": len(tracks), "train": splits.count("train"), "test": splits.count("test")}))
    else:
        print(json.dumps(build(args.source, args.output), indent=2))


if __name__ == "__main__":
    main()
