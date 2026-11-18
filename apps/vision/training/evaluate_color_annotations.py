"""Evalúa clasificadores de color contra la prueba congelada del dataset de aprendizaje (fase 4).

Lee una exportación de ``python -m vigia_backend.training_export --task color`` y mide,
**solo con el split ``test``** (grupos cámara + día que nunca se usan para entrenar ni
para elegir épocas o umbrales):

- exactitud y macro-F1 sobre los 8 colores;
- precisión, recall y F1 por color, y exactitud por cámara;
- lo que el modelo del edge predijo en su momento (``predicted`` del manifiesto), como
  línea base sin volver a correr nada.

Con ``--candidate`` (y opcionalmente ``--baseline``) corre los pesos sobre las mismas
imágenes. Un candidato solo se propone si supera a la línea base en macro-F1 sin bajar
la exactitud de ninguna cámara más de ``--max-camera-drop`` puntos. El reporte guarda el
digest de cada peso y la huella del dataset, para que el resultado sea reproducible.

  .venv/bin/python training/evaluate_color_annotations.py --data exports/colores-v1 \\
      --candidate runs/vigia-colors/v2/weights/best.pt --baseline models/vigia-colors.pt
"""
from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

COLORS = ("black", "blue", "brown", "gray", "green", "red", "white", "yellow")


def classification_report(pairs: list[tuple[str, str | None]], labels: tuple[str, ...] = COLORS) -> dict:
    """``pairs`` = (verdad, predicción). Una predicción vacía cuenta como error."""
    total = len(pairs)
    correct = sum(1 for truth, guess in pairs if truth == guess)
    per_class: dict[str, dict[str, float]] = {}
    f1s: list[float] = []
    for label in labels:
        tp = sum(1 for truth, guess in pairs if truth == label and guess == label)
        fp = sum(1 for truth, guess in pairs if truth != label and guess == label)
        fn = sum(1 for truth, guess in pairs if truth == label and guess != label)
        support = tp + fn
        if support == 0 and fp == 0:
            continue
        precision = tp / (tp + fp) if tp + fp else 0.0
        recall = tp / support if support else 0.0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
        per_class[label] = {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(f1, 4), "support": support}
        if support:
            f1s.append(f1)
    return {
        "samples": total,
        "accuracy": round(correct / total, 4) if total else 0.0,
        "macro_f1": round(sum(f1s) / len(f1s), 4) if f1s else 0.0,
        "per_class": per_class,
    }


def per_camera_accuracy(rows: list[tuple[str, str, str | None]]) -> dict[str, dict[str, float]]:
    """``rows`` = (cámara, verdad, predicción)."""
    grouped: dict[str, list[bool]] = defaultdict(list)
    for camera, truth, guess in rows:
        grouped[camera].append(truth == guess)
    return {camera: {"accuracy": round(sum(hits) / len(hits), 4), "samples": len(hits)} for camera, hits in sorted(grouped.items())}


def test_samples(manifest: dict) -> list[dict]:
    return [s for s in manifest["samples"] if s.get("split") == "test" and s.get("file") and s["label"] in COLORS]


def decide(candidate: dict, baseline: dict, max_camera_drop: float) -> dict:
    """¿Se propone el candidato? Mejor macro-F1 y ninguna cámara cae más del margen."""
    drops = {camera: round(baseline["cameras"][camera]["accuracy"] - stats["accuracy"], 4)
             for camera, stats in candidate["cameras"].items() if camera in baseline["cameras"]}
    worst = max(drops.values(), default=0.0)
    better = candidate["report"]["macro_f1"] > baseline["report"]["macro_f1"]
    return {"promote": better and worst <= max_camera_drop, "macro_f1_gain": round(
        candidate["report"]["macro_f1"] - baseline["report"]["macro_f1"], 4), "worst_camera_drop": worst, "camera_drops": drops}


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_model(weights: Path, data: Path, samples: list[dict], imgsz: int) -> dict:
    from ultralytics import YOLO

    model = YOLO(str(weights))
    rows: list[tuple[str, str, str | None]] = []
    for sample in samples:
        result = model.predict(str(data / sample["file"]), imgsz=imgsz, verbose=False)[0]
        names = result.names
        guess = names[int(result.probs.top1)] if result.probs is not None else None
        rows.append((sample["camera_id"], sample["label"], guess))
    return evaluated(rows) | {"weights": str(weights), "sha256": file_digest(weights)}


def evaluated(rows: list[tuple[str, str, str | None]]) -> dict:
    return {"report": classification_report([(truth, guess) for _, truth, guess in rows]), "cameras": per_camera_accuracy(rows)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--data", required=True, type=Path, help="Exportación con manifest.json")
    parser.add_argument("--candidate", type=Path, help="Pesos nuevos (.pt)")
    parser.add_argument("--baseline", type=Path, help="Pesos en producción (.pt); sin él, la línea base es lo que predijo el edge")
    parser.add_argument("--imgsz", type=int, default=128)
    parser.add_argument("--max-camera-drop", type=float, default=0.05)
    parser.add_argument("--report", type=Path, help="Dónde guardar el reporte JSON")
    args = parser.parse_args()

    manifest = json.loads((args.data / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("task") != "color":
        raise SystemExit("La exportación no es de color.")
    samples = test_samples(manifest)
    if not samples:
        raise SystemExit("La prueba congelada está vacía: hacen falta más etiquetas de cámaras y días distintos.")

    report: dict = {"dataset_fingerprint": manifest["dataset_fingerprint"], "test_samples": len(samples),
                    "edge_at_the_time": evaluated([(s["camera_id"], s["label"], s.get("predicted")) for s in samples])}
    baseline = run_model(args.baseline, args.data, samples, args.imgsz) if args.baseline else report["edge_at_the_time"]
    report["baseline"] = baseline
    if args.candidate:
        report["candidate"] = run_model(args.candidate, args.data, samples, args.imgsz)
        report["decision"] = decide(report["candidate"], baseline, args.max_camera_drop)
    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.report:
        args.report.write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
