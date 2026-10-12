"""Construye el dataset de clasificación de color de vehículos (formato Ultralytics).

Acepta carpetas con una subcarpeta por color, directamente (``fuente/<color>/*.jpg``) o
dentro de splits (``fuente/train/<color>/*.jpg``, como VCoR o los recortes de sitio de
site_color_crops.py). Unifica los nombres de color con el vocabulario de VIGIA y descarta
duplicados exactos e imágenes diminutas o ilegibles. Las fuentes con splits los conservan
(así un vehículo de la prueba de sitio nunca llega a train); las demás se reparten
train/val/test de forma estratificada y reproducible:

  .venv/bin/python training/build_color_dataset.py datasets/colors/hf-wandererguy \
      --output datasets/colors/vigia-colors-v1
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import shutil
from collections import Counter, defaultdict
from pathlib import Path

# Colores que VIGIA reporta: los frecuentes en el parque automotor y distinguibles en
# cámara. "gray" agrupa gris y plateado, que con luz real no se separan de forma fiable.
VIGIA_COLORS = ("black", "blue", "brown", "gray", "green", "red", "white", "yellow")
ALIASES = {
    "grey": "gray",
    "silver": "gray",
}
IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}
SPLITS = ("train", "val", "test")


def vigia_color(name: str) -> str | None:
    """Nombre de carpeta → color de VIGIA, o None si el color no se reporta."""
    key = name.strip().lower()
    key = ALIASES.get(key, key)
    return key if key in VIGIA_COLORS else None


def class_dirs(source: Path) -> list[tuple[Path, str | None]]:
    """(carpeta de color, split fijo o None si la fuente no trae splits)."""
    split_dirs = [(source / name, "val" if name == "valid" else name)
                  for name in ("train", "val", "valid", "test") if (source / name).is_dir()]
    roots = split_dirs or [(source, None)]
    return sorted((child, split) for root, split in roots for child in root.iterdir() if child.is_dir())


def image_size(path: Path) -> tuple[int, int] | None:
    from PIL import Image

    try:
        with Image.open(path) as image:
            image.verify()
        with Image.open(path) as image:
            return image.size
    except Exception:
        return None


def split_counts(total: int, val: float, test: float) -> tuple[int, int, int]:
    n_test = round(total * test) if total >= 3 else 0
    n_val = round(total * val) if total >= 3 else 0
    if total >= 3:
        n_test, n_val = max(n_test, 1), max(n_val, 1)
    return total - n_val - n_test, n_val, n_test


def build_dataset(
    sources: list[Path],
    output: Path,
    *,
    val: float = 0.1,
    test: float = 0.1,
    min_side: int = 24,
    seed: int = 7,
) -> dict:
    if output.exists():
        raise FileExistsError(f"El destino ya existe: {output}")
    if not sources:
        raise ValueError("Indica al menos una fuente.")

    by_color: dict[str, list[tuple[str, Path]]] = defaultdict(list)
    fixed: dict[str, dict[str, list[tuple[str, Path]]]] = defaultdict(lambda: defaultdict(list))
    seen: set[str] = set()
    skipped: Counter[str] = Counter()
    for source in sources:
        for folder, fixed_split in class_dirs(source.resolve()):
            color = vigia_color(folder.name)
            for image in sorted(folder.iterdir()):
                if not image.is_file() or image.suffix.lower() not in IMAGE_SUFFIXES:
                    continue
                if color is None:
                    skipped[f"color:{folder.name.lower()}"] += 1
                    continue
                digest = hashlib.sha256(image.read_bytes()).hexdigest()
                if digest in seen:
                    skipped["duplicada"] += 1
                    continue
                size = image_size(image)
                if size is None:
                    skipped["ilegible"] += 1
                    continue
                if min(size) < min_side:
                    skipped["diminuta"] += 1
                    continue
                seen.add(digest)
                if fixed_split:
                    fixed[color][fixed_split].append((digest, image))
                else:
                    by_color[color].append((digest, image))

    missing = [color for color in VIGIA_COLORS
               if len(by_color[color]) + sum(len(items) for items in fixed[color].values()) < 3]
    if missing:
        raise ValueError(f"Faltan imágenes (mínimo 3) para: {', '.join(missing)}")

    counts = {split: {} for split in SPLITS}
    try:
        for color in VIGIA_COLORS:
            # Sorting by content hash first makes the split independent of file names.
            items = sorted(by_color[color])
            random.Random(f"{seed}:{color}").shuffle(items)
            n_train, n_val, _ = split_counts(len(items), val, test)
            parts = {
                "train": items[:n_train] + sorted(fixed[color]["train"]),
                "val": items[n_train:n_train + n_val] + sorted(fixed[color]["val"]),
                "test": items[n_train + n_val:] + sorted(fixed[color]["test"]),
            }
            for split, part in parts.items():
                target_dir = output / split / color
                target_dir.mkdir(parents=True, exist_ok=True)
                for digest, image in part:
                    shutil.copy2(image, target_dir / f"{digest[:16]}{image.suffix.lower()}")
                counts[split][color] = len(part)

        summary = {
            "version": 1,
            "classes": list(VIGIA_COLORS),
            "aliases": ALIASES,
            "sources": [source.name for source in sources],
            "counts": counts,
            "skipped": dict(sorted(skipped.items())),
        }
        (output / "dataset-summary.json").write_text(
            json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("sources", nargs="+", type=Path, help="Carpetas con una subcarpeta por color")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--val", type=float, default=0.1)
    parser.add_argument("--test", type=float, default=0.1)
    parser.add_argument("--min-side", type=int, default=24, help="Descarta recortes con un lado menor (px)")
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()
    summary = build_dataset(
        args.sources, args.output, val=args.val, test=args.test, min_side=args.min_side, seed=args.seed
    )
    print(json.dumps({key: summary[key] for key in ("counts", "skipped")}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
