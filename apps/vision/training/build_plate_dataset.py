from __future__ import annotations

import argparse
import json
import re
import shutil
from pathlib import Path


VALID_SPLITS = {"train", "val", "test"}


def safe_prefix(source: Path) -> str:
    return re.sub(r"[^a-zA-Z0-9_-]+", "-", source.name).strip("-") or "source"


def raw_pairs(source: Path, default_split: str | None) -> list[tuple[Path, Path, str]]:
    images_dir = source / "images" / "raw"
    labels_dir = source / "labels" / "raw"
    if not images_dir.is_dir() or not labels_dir.is_dir():
        raise ValueError(f"Estructura inválida en {source}; se esperan images/raw y labels/raw.")

    manifest_path = source / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        entries = [(item["file"], item["split"]) for item in manifest.get("frames", [])]
    elif default_split:
        entries = [(image.name, default_split) for image in sorted(images_dir.glob("frame-*"))]
    else:
        raise ValueError(f"Falta manifest.json en {source}.")

    pairs: list[tuple[Path, Path, str]] = []
    for filename, split in entries:
        if split not in VALID_SPLITS:
            raise ValueError(f"Split desconocido para {filename}: {split}")
        image = images_dir / filename
        label = labels_dir / f"{Path(filename).stem}.txt"
        if not image.is_file():
            raise FileNotFoundError(f"Falta la imagen {image}")
        if not label.is_file():
            raise FileNotFoundError(f"Falta etiquetar {image.name} en {source}")
        pairs.append((image, label, split))
    return pairs


def external_pairs(source: Path) -> list[tuple[Path, Path, str]]:
    pairs: list[tuple[Path, Path, str]] = []
    for split in ("train", "val", "test"):
        images_dir = source / "images" / split
        labels_dir = source / "labels" / split
        if not images_dir.is_dir():
            continue
        for image in sorted(images_dir.iterdir()):
            if not image.is_file() or image.suffix.lower() not in {".jpg", ".jpeg", ".png", ".webp"}:
                continue
            label = labels_dir / f"{image.stem}.txt"
            if not label.is_file():
                raise FileNotFoundError(f"Falta la etiqueta externa para {image}")
            pairs.append((image, label, "train"))
    if not pairs:
        raise ValueError(f"La fuente externa no contiene imágenes: {source}")
    return pairs


def build_dataset(
    train_sources: list[Path],
    manifest_sources: list[Path],
    output: Path,
    external_sources: list[Path] | None = None,
) -> dict[str, int]:
    if output.exists():
        raise FileExistsError(f"El destino ya existe: {output}")

    all_sources = [(source.resolve(), "train") for source in train_sources]
    all_sources += [(source.resolve(), None) for source in manifest_sources]
    external_sources = external_sources or []
    if not all_sources and not external_sources:
        raise ValueError("Indica al menos una fuente.")

    counts = {split: 0 for split in VALID_SPLITS}
    try:
        for source, default_split in all_sources:
            prefix = safe_prefix(source)
            for image, label, split in raw_pairs(source, default_split):
                image_target = output / "images" / split / f"{prefix}-{image.name}"
                label_target = output / "labels" / split / f"{prefix}-{label.name}"
                image_target.parent.mkdir(parents=True, exist_ok=True)
                label_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(image, image_target)
                shutil.copy2(label, label_target)
                counts[split] += 1

        for source in external_sources:
            source = source.resolve()
            prefix = safe_prefix(source)
            for image, label, split in external_pairs(source):
                image_target = output / "images" / split / f"{prefix}-{image.name}"
                label_target = output / "labels" / split / f"{prefix}-{label.name}"
                image_target.parent.mkdir(parents=True, exist_ok=True)
                label_target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(image, image_target)
                shutil.copy2(label, label_target)
                counts[split] += 1

        if not counts["train"] or not counts["val"] or not counts["test"]:
            raise ValueError(f"El dataset necesita imágenes en train, val y test: {counts}")

        yaml = (
            f"path: {output.resolve()}\n"
            "train: images/train\n"
            "val: images/val\n"
            "test: images/test\n\n"
            "names:\n"
            "  0: plate\n"
        )
        (output / "data.yaml").write_text(yaml, encoding="utf-8")
        (output / "dataset-summary.json").write_text(
            json.dumps({"version": 1, "counts": counts}, indent=2) + "\n",
            encoding="utf-8",
        )
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise
    return counts


def main() -> None:
    parser = argparse.ArgumentParser(description="Construye el dataset YOLO final sin mezclar los splits.")
    parser.add_argument("--train-source", action="append", type=Path, default=[])
    parser.add_argument("--manifest-source", action="append", type=Path, default=[])
    parser.add_argument(
        "--external-source",
        action="append",
        type=Path,
        default=[],
        help="Dataset YOLO público; todos sus splits se incorporan únicamente a train.",
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    counts = build_dataset(
        args.train_source,
        args.manifest_source,
        args.output.resolve(),
        args.external_source,
    )
    print(f"Dataset creado en {args.output}: {counts}")


if __name__ == "__main__":
    main()
