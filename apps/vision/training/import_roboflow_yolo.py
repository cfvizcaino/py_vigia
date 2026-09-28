from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Any

import yaml
from PIL import Image


IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
SPLIT_KEYS = (("train", "train"), ("val", "val"), ("valid", "val"), ("test", "test"))
PLATE_CLASS_ALIASES = {"0", "placa", "plate", "license_plate", "license plate"}

DATASET_PROFILES = {
    "colombian-rigwf-v2": {
        "source": "Roboflow Universe: placas-colombianas-rigwf/2",
        "source_url": "https://universe.roboflow.com/placas-colombianas/placas-colombianas-rigwf",
        "declared_license": "Public Domain",
    },
    "colombian-kappsai-v1": {
        "source": "Roboflow Universe: plate_detection_colombia/1",
        "source_url": "https://universe.roboflow.com/sao6/plate_detection_colombia-bhcwi",
        "declared_license": "CC BY 4.0",
    },
}


def safe_extract(archive: Path, destination: Path) -> None:
    destination = destination.resolve()
    with zipfile.ZipFile(archive) as zipped:
        for member in zipped.infolist():
            target = (destination / member.filename).resolve()
            if destination not in target.parents and target != destination:
                raise ValueError(f"Ruta insegura dentro del ZIP: {member.filename}")
        zipped.extractall(destination)


def find_data_yaml(root: Path) -> Path:
    candidates = sorted(root.rglob("data.yaml")) + sorted(root.rglob("data.yml"))
    if not candidates:
        raise FileNotFoundError("El export de Roboflow no contiene data.yaml.")
    return candidates[0]


def class_names(config: dict[str, Any]) -> list[str]:
    names = config.get("names")
    if isinstance(names, list):
        return [str(name) for name in names]
    if isinstance(names, dict):
        return [str(names[key]) for key in sorted(names, key=lambda value: int(value))]
    raise ValueError("data.yaml no contiene una lista válida de clases.")


def resolve_images_dir(data_yaml: Path, config: dict[str, Any], value: str) -> Path:
    base = data_yaml.parent
    configured_root = config.get("path")
    if configured_root:
        candidate_root = Path(str(configured_root))
        if not candidate_root.is_absolute():
            candidate_root = (base / candidate_root).resolve()
        candidate = (candidate_root / value).resolve()
        if candidate.is_dir():
            return candidate
    candidate = (base / value).resolve()
    if candidate.is_dir():
        return candidate
    raise FileNotFoundError(f"No se encontró el directorio de imágenes declarado: {value}")


def labels_dir_for(images_dir: Path) -> Path:
    parts = list(images_dir.parts)
    if "images" in parts:
        index = len(parts) - 1 - parts[::-1].index("images")
        parts[index] = "labels"
        candidate = Path(*parts)
    else:
        candidate = images_dir.parent / "labels"
    if not candidate.is_dir():
        raise FileNotFoundError(f"No se encontró el directorio de etiquetas para {images_dir}")
    return candidate


def parse_label(label: Path, width: int, height: int) -> list[tuple[float, float, float, float]]:
    sizes: list[tuple[float, float, float, float]] = []
    for number, line in enumerate(label.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        parts = line.split()
        if len(parts) != 5:
            raise ValueError(f"{label}:{number}: se esperaban 5 columnas.")
        class_id = int(parts[0])
        values = [float(value) for value in parts[1:]]
        if class_id != 0:
            raise ValueError(f"{label}:{number}: solo se admite la clase 0 (plate).")
        center_x, center_y, box_width, box_height = values
        if not all(0 <= value <= 1 for value in values) or box_width <= 0 or box_height <= 0:
            raise ValueError(f"{label}:{number}: caja YOLO fuera de rango.")
        if center_x - box_width / 2 < -1e-6 or center_x + box_width / 2 > 1.000001:
            raise ValueError(f"{label}:{number}: caja fuera del ancho de la imagen.")
        if center_y - box_height / 2 < -1e-6 or center_y + box_height / 2 > 1.000001:
            raise ValueError(f"{label}:{number}: caja fuera del alto de la imagen.")
        sizes.append((box_width * width, box_height * height, box_width, box_height))
    return sizes


def import_dataset(
    source: Path,
    output: Path,
    profile: str | None = None,
) -> dict[str, Any]:
    if output.exists():
        raise FileExistsError(f"El destino ya existe: {output}")

    with tempfile.TemporaryDirectory(prefix="vigia-roboflow-") as temporary:
        if source.is_file():
            safe_extract(source, Path(temporary))
            root = Path(temporary)
        elif source.is_dir():
            root = source
        else:
            raise FileNotFoundError(f"No existe el export: {source}")

        data_yaml = find_data_yaml(root)
        config = yaml.safe_load(data_yaml.read_text(encoding="utf-8"))
        if not isinstance(config, dict):
            raise ValueError("data.yaml no contiene un objeto YAML válido.")
        names = class_names(config)
        if len(names) != 1 or names[0].strip().lower() not in PLATE_CLASS_ALIASES:
            raise ValueError(f"Se esperaba una sola clase de placa, se encontró: {names}")

        source_metadata = DATASET_PROFILES.get(
            profile or "",
            {
                "source": "Export YOLO de Roboflow Universe",
                "source_url": None,
                "declared_license": "Sin verificar",
            },
        )

        counts = {"train": 0, "val": 0, "test": 0}
        boxes = 0
        widths: list[float] = []
        width_ratios: list[float] = []
        tight_crop_images = 0
        duplicates: list[str] = []
        hashes: set[str] = set()
        processed_keys: set[str] = set()
        try:
            for source_key, target_split in SPLIT_KEYS:
                if source_key not in config or target_split in processed_keys:
                    continue
                processed_keys.add(target_split)
                images_dir = resolve_images_dir(data_yaml, config, str(config[source_key]))
                labels_dir = labels_dir_for(images_dir)
                images = sorted(path for path in images_dir.iterdir() if path.suffix.lower() in IMAGE_SUFFIXES)
                for image in images:
                    label = labels_dir / f"{image.stem}.txt"
                    if not label.is_file():
                        raise FileNotFoundError(f"Falta la etiqueta para {image}")
                    digest = hashlib.sha256(image.read_bytes()).hexdigest()
                    if digest in hashes:
                        duplicates.append(str(image.relative_to(root)))
                        continue
                    hashes.add(digest)
                    with Image.open(image) as opened:
                        image_width, image_height = opened.size
                    sizes = parse_label(label, image_width, image_height)
                    widths.extend(width for width, _, _, _ in sizes)
                    width_ratios.extend(width_ratio for _, _, width_ratio, _ in sizes)
                    if any(width_ratio >= 0.5 for _, _, width_ratio, _ in sizes):
                        tight_crop_images += 1
                    boxes += len(sizes)

                    filename = f"{target_split}-{image.name}"
                    image_target = output / "images" / target_split / filename
                    label_target = output / "labels" / target_split / f"{Path(filename).stem}.txt"
                    image_target.parent.mkdir(parents=True, exist_ok=True)
                    label_target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(image, image_target)
                    shutil.copy2(label, label_target)
                    counts[target_split] += 1

            if not counts["train"]:
                raise ValueError("El dataset importado no contiene imágenes de entrenamiento.")
            ordered_widths = sorted(widths)
            ordered_width_ratios = sorted(width_ratios)
            total_images = sum(counts.values())
            tight_crop_ratio = tight_crop_images / total_images if total_images else 0
            warnings = []
            if tight_crop_ratio >= 0.5:
                warnings.append(
                    "Predominan primeros planos: no usar este dataset para el detector de placas en cuadros completos."
                )
            audit = {
                "version": 1,
                **source_metadata,
                "profile": profile,
                "class_names": ["plate"],
                "counts": counts,
                "boxes": boxes,
                "duplicate_images_skipped": len(duplicates),
                "duplicates": duplicates,
                "plate_width_px": {
                    "min": round(min(widths), 2) if widths else None,
                    "median": round(ordered_widths[len(ordered_widths) // 2], 2) if widths else None,
                    "max": round(max(widths), 2) if widths else None,
                },
                "plate_width_ratio": {
                    "min": round(min(width_ratios), 4) if width_ratios else None,
                    "median": (
                        round(ordered_width_ratios[len(ordered_width_ratios) // 2], 4)
                        if width_ratios
                        else None
                    ),
                    "max": round(max(width_ratios), 4) if width_ratios else None,
                },
                "tight_crop_images": tight_crop_images,
                "tight_crop_ratio": round(tight_crop_ratio, 4),
                "warnings": warnings,
                "manual_review_required": True,
            }
            (output / "audit.json").write_text(json.dumps(audit, indent=2) + "\n", encoding="utf-8")
            (output / "data.yaml").write_text(
                f"path: {output.resolve()}\n"
                "train: images/train\n"
                "val: images/val\n"
                "test: images/test\n\n"
                "names:\n"
                "  0: plate\n",
                encoding="utf-8",
            )
            return audit
        except Exception:
            shutil.rmtree(output, ignore_errors=True)
            raise


def main() -> None:
    parser = argparse.ArgumentParser(description="Importa y audita un export YOLOv8 de Roboflow para VIGIA.")
    parser.add_argument("--source", required=True, type=Path, help="ZIP descargado o directorio descomprimido.")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--profile", choices=sorted(DATASET_PROFILES))
    args = parser.parse_args()
    audit = import_dataset(args.source.resolve(), args.output.resolve(), args.profile)
    print(json.dumps(audit, indent=2))


if __name__ == "__main__":
    main()
