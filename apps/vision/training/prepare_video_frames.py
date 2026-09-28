from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path

import cv2


RANGE_PATTERN = re.compile(r"^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$")


@dataclass(frozen=True)
class FrameRecord:
    file: str
    timestamp_seconds: float
    split: str


def parse_range(value: str) -> tuple[float, float]:
    match = RANGE_PATTERN.fullmatch(value)
    if not match:
        raise argparse.ArgumentTypeError("Usa el formato INICIO:FIN, por ejemplo 0:200.")
    start, end = map(float, match.groups())
    if start < 0 or end <= start:
        raise argparse.ArgumentTypeError("El rango debe cumplir 0 <= INICIO < FIN.")
    return start, end


def timestamps(start: float, end: float, interval: float) -> list[float]:
    values: list[float] = []
    current = start
    while current < end - 1e-6:
        values.append(round(current, 3))
        current += interval
    return values


def extract_frames(
    video: Path,
    output: Path,
    ranges: dict[str, tuple[float, float]],
    interval: float,
) -> list[FrameRecord]:
    images_dir = output / "images" / "raw"
    labels_dir = output / "labels" / "raw"
    images_dir.mkdir(parents=True, exist_ok=True)
    labels_dir.mkdir(parents=True, exist_ok=True)

    if any(images_dir.iterdir()) or any(labels_dir.iterdir()):
        raise FileExistsError(f"La fuente ya contiene archivos: {output}")

    capture = cv2.VideoCapture(str(video))
    if not capture.isOpened():
        raise RuntimeError(f"No se pudo abrir el video: {video}")

    duration = capture.get(cv2.CAP_PROP_FRAME_COUNT) / max(capture.get(cv2.CAP_PROP_FPS), 1)
    records: list[FrameRecord] = []
    try:
        for split, (start, end) in ranges.items():
            if end > duration + 1:
                raise ValueError(f"El rango {split} termina en {end}s, pero el video dura {duration:.1f}s.")
            for timestamp in timestamps(start, end, interval):
                capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
                ok, frame = capture.read()
                if not ok:
                    raise RuntimeError(f"No se pudo extraer el fotograma en {timestamp}s.")
                filename = f"frame-{len(records) + 1:06d}.jpg"
                if not cv2.imwrite(str(images_dir / filename), frame, [cv2.IMWRITE_JPEG_QUALITY, 95]):
                    raise RuntimeError(f"No se pudo escribir {filename}.")
                records.append(FrameRecord(filename, timestamp, split))
    finally:
        capture.release()

    manifest = {
        "version": 1,
        "source_video": video.name,
        "interval_seconds": interval,
        "frames": [asdict(record) for record in records],
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return records


def main() -> None:
    parser = argparse.ArgumentParser(description="Extrae fotogramas separados temporalmente para etiquetar placas.")
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--interval", type=float, default=5.0, help="Segundos entre fotogramas.")
    parser.add_argument("--train", type=parse_range, required=True, metavar="INICIO:FIN")
    parser.add_argument("--val", type=parse_range, required=True, metavar="INICIO:FIN")
    parser.add_argument("--test", type=parse_range, required=True, metavar="INICIO:FIN")
    args = parser.parse_args()

    if args.interval <= 0:
        parser.error("--interval debe ser mayor que cero.")
    if not args.video.is_file():
        parser.error(f"No existe el video: {args.video}")

    ranges = {"train": args.train, "val": args.val, "test": args.test}
    ordered = sorted((start, end, split) for split, (start, end) in ranges.items())
    if any(left[1] > right[0] for left, right in zip(ordered, ordered[1:])):
        parser.error("Los rangos de train, val y test no pueden superponerse.")

    records = extract_frames(args.video.resolve(), args.output.resolve(), ranges, args.interval)
    counts = {split: sum(record.split == split for record in records) for split in ranges}
    print(f"Fuente creada en {args.output}: {len(records)} imágenes ({counts}).")


if __name__ == "__main__":
    main()
