"""Exporta una versión inmutable del dataset de aprendizaje (fase 4).

  python -m vigia_backend.training_export --output /app/data/exports/colores-2026-11-18 --task color

- **Color:** `<salida>/<split>/<color>/<sha256>.jpg`, el mismo formato que
  `apps/vision/training/site_color_crops.py build`, así que
  `build_color_dataset.py` lo incorpora respetando los splits.
- **Placa:** `<salida>/<split>/<sha256>.jpg` y `labels.jsonl` con el texto exacto.

El split se decide por **grupo cámara + día (hora de Bogotá)** con un hash estable: un
mismo grupo cae siempre en el mismo split, así que la prueba queda congelada y los
recortes casi iguales de un mismo paso nunca se reparten entre entrenamiento y prueba.
Las imágenes se deduplican por hash; si dos etiquetas discrepan sobre la misma imagen,
se excluye y queda anotado. `no_determinable`, `ilegible` y `sin_placa` se cuentan pero
no entran a las carpetas de clase de color (sí a placas, como negativos).

`manifest.json` registra fuentes, conteos, exclusiones, splits y cada muestra. Contiene
textos de placa: es dato personal y sigue la misma política del almacén de aprendizaje.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from .dataset import COLOR_LABELS, NOT_DETERMINABLE, PLATE_ABSENT, PLATE_UNREADABLE, dataset_store, retention_days
from .models import TrainingAnnotation, utc_now

BOGOTA = timezone(timedelta(hours=-5))
EXPORT_VERSION = 1


def split_for(group: str, test_share: float = 0.2, val_share: float = 0.1) -> str:
    """Hash estable del grupo → train/val/test. Mismo grupo, mismo split, siempre."""
    bucket = int(hashlib.sha256(group.encode("utf-8")).hexdigest()[:8], 16) / 0xFFFFFFFF
    if bucket < test_share:
        return "test"
    if bucket < test_share + val_share:
        return "val"
    return "train"


def group_of(row: TrainingAnnotation) -> str:
    observed = row.observed_at if row.observed_at.tzinfo else row.observed_at.replace(tzinfo=timezone.utc)
    return f"{row.camera_id}|{observed.astimezone(BOGOTA).date().isoformat()}"


def export_dataset(db: Session, output: Path, task: str, *, test_share: float = 0.2, val_share: float = 0.1,
                   store=None, now: datetime | None = None) -> dict:
    if output.exists():
        raise FileExistsError(f"El destino ya existe (cada versión es inmutable): {output}")
    store = store or dataset_store()
    if store is None:
        raise RuntimeError("No hay almacén de aprendizaje configurado (DATASET_* o THUMBNAIL_*).")

    rows = list(db.scalars(select(TrainingAnnotation).where(TrainingAnnotation.task == task)
                           .order_by(TrainingAnnotation.updated_at)))
    by_sha: dict[str, list[TrainingAnnotation]] = defaultdict(list)
    for row in rows:
        by_sha[row.image_sha256].append(row)

    excluded: Counter[str] = Counter()
    samples: list[dict] = []
    counts: dict[str, Counter[str]] = defaultdict(Counter)
    cameras: dict[str, Counter[str]] = defaultdict(Counter)
    plate_lines: list[dict] = []
    output.mkdir(parents=True)
    for sha, same_image in sorted(by_sha.items()):
        labels = {row.label for row in same_image}
        if len(labels) > 1:
            excluded["etiquetas_en_conflicto"] += 1
            continue
        row = same_image[-1]
        data = store.get(row.sample_key)
        if data is None:
            excluded["imagen_no_encontrada"] += 1
            continue
        if hashlib.sha256(data).hexdigest() != sha:
            excluded["hash_distinto"] += 1
            continue
        split = split_for(group_of(row), test_share, val_share)
        sample = {
            "sha256": sha, "split": split, "label": row.label, "predicted": row.predicted,
            "camera_id": row.camera_id, "group": group_of(row), "track_id": row.track_id,
            "observed_at": row.observed_at.isoformat(), "model_digest": row.model_digest,
            "detection_confidence": row.detection_confidence,
        }
        if task == "color":
            if row.label == NOT_DETERMINABLE or row.label not in COLOR_LABELS:
                excluded[NOT_DETERMINABLE] += 1
                sample["file"] = None
                samples.append(sample)
                continue
            relative = Path(split) / row.label / f"{sha}.jpg"
        else:
            relative = Path(split) / f"{sha}.jpg"
            plate_lines.append({"file": relative.as_posix(), "label": row.label, "predicted": row.predicted, "split": split,
                                "visible": row.label not in (PLATE_UNREADABLE, PLATE_ABSENT)})
        (output / relative).parent.mkdir(parents=True, exist_ok=True)
        (output / relative).write_bytes(data)
        sample["file"] = relative.as_posix()
        samples.append(sample)
        counts[split][row.label] += 1
        cameras[split][row.camera_id] += 1

    if task == "plate":
        with (output / "labels.jsonl").open("w", encoding="utf-8") as handle:
            for line in plate_lines:
                handle.write(json.dumps(line, ensure_ascii=False) + "\n")

    fingerprint = hashlib.sha256("\n".join(f"{s['sha256']}:{s['label']}:{s['split']}" for s in samples).encode()).hexdigest()
    manifest = {
        "export_version": EXPORT_VERSION,
        "task": task,
        "created_at": (now or utc_now()).isoformat(),
        "dataset_fingerprint": fingerprint,
        "split_rule": {"group": "camera_id + día de Bogotá", "test_share": test_share, "val_share": val_share,
                       "hash": "sha256(group)[:8]"},
        "source": {"annotations": len(rows), "unique_images": len(by_sha), "retention_days": retention_days()},
        "counts": {split: dict(sorted(c.items())) for split, c in sorted(counts.items())},
        "cameras": {split: dict(sorted(c.items())) for split, c in sorted(cameras.items())},
        "excluded": dict(sorted(excluded.items())),
        "corrected": sum(1 for s in samples if s["predicted"] is not None and s["predicted"] != s["label"]),
        "samples": samples,
    }
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return manifest


def main() -> None:
    from .db import SessionLocal

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--task", choices=("color", "plate"), required=True)
    parser.add_argument("--test-share", type=float, default=0.2)
    parser.add_argument("--val-share", type=float, default=0.1)
    args = parser.parse_args()
    with SessionLocal() as db:
        manifest = export_dataset(db, args.output, args.task, test_share=args.test_share, val_share=args.val_share)
    print(json.dumps({key: manifest[key] for key in ("task", "dataset_fingerprint", "counts", "excluded", "corrected")},
                     ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
