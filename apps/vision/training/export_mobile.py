"""Exporta un modelo YOLO a TensorFlow Lite para los edges Android autónomos.

Genera el modelo y un manifiesto JSON (tarea, clases, tamaño de entrada, formato de salida
y SHA-256) que la app usa sin suposiciones. Sirve para el detector de vehículos, el
clasificador de color y el futuro detector de placas.

Requiere un entorno con TensorFlow (Python 3.12), separado del nodo de visión:
  ~/development/vigia-export/bin/python training/export_mobile.py yolo26n.pt \
      --imgsz 320 --labels 2:car,3:motorcycle --output ../movil/assets/models/vehicles
  ~/development/vigia-export/bin/python training/export_mobile.py \
      runs/vigia-colors/yolo26n-colors/weights/best.pt --imgsz 128 --output ../movil/assets/models/colors
"""
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from pathlib import Path


def parse_labels(value: str) -> dict[int, str]:
    labels = {}
    for item in value.split(","):
        index, _, name = item.partition(":")
        if not index.strip().isdigit() or not name.strip():
            raise argparse.ArgumentTypeError("Usa índice:etiqueta separados por comas, p. ej. 2:car,3:motorcycle")
        labels[int(index)] = name.strip()
    return labels


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("weights", type=Path)
    parser.add_argument("--imgsz", type=int, default=320, help="Lado de la entrada; 320 equilibra velocidad y alcance en teléfonos")
    parser.add_argument("--labels", type=parse_labels,
                        help="Clases que la app reporta, p. ej. 2:car,3:motorcycle (detectores; un clasificador usa todas)")
    parser.add_argument("--output", type=Path, required=True, help="Ruta sin extensión: crea .tflite y .json")
    # float32 by default: with w8a32 (INT8 weights) LiteRT 1.4 on Android/ARM fails at
    # Invoke ("Input tensor N lacks data") in hybrid convolutions under XNNPack.
    parser.add_argument("--quantize", default="32", choices=["32", "w8a32"],
                        help="32 (por defecto): float32, compatible con XNNPack en cualquier CPU; "
                             "w8a32: pesos INT8, 3 veces más pequeño pero falla en Android con LiteRT 1.4")
    args = parser.parse_args()

    from ultralytics import YOLO

    model = YOLO(str(args.weights))
    if model.task not in ("detect", "classify"):
        parser.error(f"Tarea no soportada: {model.task}")
    labels = args.labels or {}
    if model.task == "classify":
        # The app maps the argmax back to these names; every class is reported.
        labels = {int(index): name for index, name in model.names.items()}
    elif not labels:
        parser.error("--labels es obligatorio para un detector")
    quantize = 32 if args.quantize == "32" else args.quantize
    exported = Path(model.export(format="tflite", imgsz=args.imgsz, quantize=quantize, nms=False))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    target = args.output.with_suffix(".tflite")
    shutil.copyfile(exported, target)

    from ai_edge_litert.interpreter import Interpreter

    interpreter = Interpreter(model_path=str(target))
    inputs = interpreter.get_input_details()
    outputs = interpreter.get_output_details()
    shape = [int(v) for v in inputs[0]["shape"]]
    # litert_torch keeps PyTorch's channel-first layout; the app reads this field.
    layout = "NCHW" if shape[1] == 3 else "NHWC"
    manifest = {
        "schema": "vigia-mobile-model/1",
        "task": model.task,
        "source": args.weights.name,
        "quantize": args.quantize,
        "file": target.name,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "input": {"shape": shape, "dtype": str(inputs[0]["dtype"].__name__), "layout": layout, "range": [0, 1]},
        "output": {"shape": [int(v) for v in outputs[0]["shape"]], "dtype": str(outputs[0]["dtype"].__name__)},
        "labels": {str(index): name for index, name in sorted(labels.items())},
        "names": {str(index): name for index, name in model.names.items()},
    }
    target.with_suffix(".json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({k: manifest[k] for k in ("file", "sha256", "input", "output", "labels")}, indent=2))


if __name__ == "__main__":
    main()
