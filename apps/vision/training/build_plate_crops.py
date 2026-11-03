"""Construye el dataset del detector de placas como recortes de vehículos, igual que la inferencia.

El nodo busca la placa dentro del recorte de cada vehículo (``vigia_vision/plates.py``: margen
del 4 % y ``imgsz=640``). Entrenar con fotogramas completos a 768-960 px dejaba las placas de un
4K en 3-10 px y con otra escala que en inferencia. Aquí cada muestra es un vehículo:

- se descartan vehículos pequeños (``--min-vehicle``) y los que tocan el borde del fotograma
  (vehículos cortados, con placas a medias);
- se descarta el recorte si corta una placa: una placa a medias sin etiqueta enseña lo contrario;
- los vehículos sin placa visible (de lado, motos de frente) quedan como ejemplos negativos;
- cada fuente conserva su split (manifest.json); sin manifiesto, todo va a train.

Cada fuente necesita ``images/raw``, ``labels/raw`` (YOLO, coordenadas del fotograma) y
``vehicles.json`` (``training/prelabel_plates.py vehicles``).

  .venv/bin/python training/build_plate_crops.py datasets/plates/source_placas_03 \
      datasets/plates/source_phone_01 --output datasets/plates/vigia-plate-crops-v1
"""
from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

PADDING = 0.04  # Same as vigia_vision.plates.detect_plates.
SPLITS = ("train", "val", "test")


def _splits(source: Path) -> dict[str, str]:
    manifest = source / "manifest.json"
    if not manifest.is_file():
        return {}
    return {frame["file"]: frame["split"] for frame in json.loads(manifest.read_text(encoding="utf-8"))["frames"]}


def _plates(label_file: Path, width: int, height: int) -> list[list[float]]:
    boxes = []
    if label_file.is_file():
        for line in label_file.read_text(encoding="utf-8").splitlines():
            if not line.strip():
                continue
            _, cx, cy, w, h = map(float, line.split())
            boxes.append([(cx - w / 2) * width, (cy - h / 2) * height, (cx + w / 2) * width, (cy + h / 2) * height])
    return boxes


def build(sources: list[Path], output: Path, *, min_vehicle: int, edge: int) -> dict:
    import cv2

    if output.exists():
        raise FileExistsError(f"El destino ya existe: {output}")
    counts: Counter[str] = Counter()
    plates_per_split: Counter[str] = Counter()
    skipped: Counter[str] = Counter()
    try:
        for source in sources:
            splits = _splits(source)
            vehicles = json.loads((source / "vehicles.json").read_text(encoding="utf-8"))
            prefix = source.name
            for frame_name, frame_vehicles in sorted(vehicles.items()):
                split = splits.get(frame_name, "train")
                frame = cv2.imread(str(source / "images" / "raw" / frame_name))
                height, width = frame.shape[:2]
                plates = _plates(source / "labels" / "raw" / f"{Path(frame_name).stem}.txt", width, height)
                for index, vehicle in enumerate(frame_vehicles):
                    x1, y1, x2, y2 = vehicle["box"]
                    if x2 - x1 < min_vehicle:
                        skipped["vehículo pequeño"] += 1
                        continue
                    if x1 <= edge or y1 <= edge or x2 >= width - edge or y2 >= height - edge:
                        skipped["toca el borde"] += 1
                        continue
                    px, py = (x2 - x1) * PADDING, (y2 - y1) * PADDING
                    cx1, cy1 = max(0, round(x1 - px)), max(0, round(y1 - py))
                    cx2, cy2 = min(width, round(x2 + px)), min(height, round(y2 + py))
                    inside, cut = [], False
                    for p in plates:
                        overlap_w = min(p[2], cx2) - max(p[0], cx1)
                        overlap_h = min(p[3], cy2) - max(p[1], cy1)
                        if overlap_w <= 0 or overlap_h <= 0:
                            continue
                        area = (p[2] - p[0]) * (p[3] - p[1])
                        if overlap_w * overlap_h < 0.9 * area:
                            cut = True
                            break
                        inside.append(p)
                    if cut:
                        skipped["cortaría una placa"] += 1
                        continue
                    cw, ch = cx2 - cx1, cy2 - cy1
                    stem = f"{prefix}-{Path(frame_name).stem}-v{index:02d}"
                    (output / "images" / split).mkdir(parents=True, exist_ok=True)
                    (output / "labels" / split).mkdir(parents=True, exist_ok=True)
                    cv2.imwrite(str(output / "images" / split / f"{stem}.jpg"), frame[cy1:cy2, cx1:cx2],
                                [cv2.IMWRITE_JPEG_QUALITY, 95])
                    lines = []
                    for p in inside:
                        bx1, by1 = max(p[0], cx1) - cx1, max(p[1], cy1) - cy1
                        bx2, by2 = min(p[2], cx2) - cx1, min(p[3], cy2) - cy1
                        lines.append(f"0 {(bx1 + bx2) / 2 / cw:.6f} {(by1 + by2) / 2 / ch:.6f} "
                                     f"{(bx2 - bx1) / cw:.6f} {(by2 - by1) / ch:.6f}")
                    (output / "labels" / split / f"{stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""),
                                                                         encoding="utf-8")
                    counts[split] += 1
                    plates_per_split[split] += len(lines)
        missing = [split for split in SPLITS if not counts[split]]
        if missing:
            raise ValueError(f"Faltan recortes en: {', '.join(missing)}")
        (output / "data.yaml").write_text(
            f"path: {output.resolve()}\ntrain: images/train\nval: images/val\ntest: images/test\n\nnames:\n  0: plate\n",
            encoding="utf-8")
        summary = {"version": 1, "sources": [s.name for s in sources], "padding": PADDING, "min_vehicle_px": min_vehicle,
                   "crops": dict(counts), "plates": dict(plates_per_split), "skipped": dict(skipped)}
        (output / "dataset-summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n",
                                                     encoding="utf-8")
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--min-vehicle", type=int, default=150, help="Ancho mínimo del vehículo en px del fotograma")
    parser.add_argument("--edge", type=int, default=4, help="Distancia al borde que cuenta como vehículo cortado")
    args = parser.parse_args()
    print(json.dumps(build(args.sources, args.output, min_vehicle=args.min_vehicle, edge=args.edge),
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
