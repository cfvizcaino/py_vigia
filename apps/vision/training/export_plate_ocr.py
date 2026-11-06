"""Exporta el OCR de placas (``models/plate-ocr.onnx``) a TensorFlow Lite para la app móvil.

``onnx2tf`` no sirve con este modelo: su entrada ya es NHWC (1×64×128×3, uint8) y la
trata como NCHW. El camino que da el mismo texto que onnxruntime es
ONNX → PyTorch (``onnx2torch``) → TFLite (``litert_torch``), con tres arreglos:

1. Lote fijo en 1 y constantes plegadas con onnxruntime (los ``Slice`` dependían de ``Shape``).
2. ``Reshape``/``Squeeze`` estáticos: onnx2torch decide su forma con los datos y
   ``torch.export`` no lo admite; con la entrada fija, la forma se registra una vez.
3. Pesos contiguos: onnx2torch deja traspuestas las matrices de ``Gemm`` y LiteRT
   serializa el almacenamiento tal cual, así que las leía en otro orden (todo salía "0").

Valida contra onnxruntime con recortes de placas reales y escribe el manifiesto que lee
la app. Requiere el entorno de exportación (TensorFlow, Python 3.12) más ``onnx2torch``:
  ~/development/vigia-export/bin/python training/export_plate_ocr.py \\
      --samples datasets/plates/vigia-plate-crops-v1 --output ../movil-rn/assets/models/plate-ocr
"""
from __future__ import annotations

import argparse
import glob
import hashlib
import json
import tempfile
from pathlib import Path

import numpy as np

MODELS = Path(__file__).resolve().parents[1] / "models"


def plate_samples(dataset: Path, width: int, height: int) -> np.ndarray:
    """Placas recortadas de las etiquetas YOLO de validación y prueba, como las ve el OCR."""
    import cv2

    plates = []
    for split in ("test", "val"):
        for image_path in sorted(glob.glob(str(dataset / "images" / split / "*"))):
            label = dataset / "labels" / split / (Path(image_path).stem + ".txt")
            if not label.exists():
                continue
            image = cv2.imread(image_path)
            h, w = image.shape[:2]
            for line in label.read_text().splitlines():
                _, x, y, bw, bh = map(float, line.split())
                x1, y1 = max(0, int((x - bw / 2) * w)), max(0, int((y - bh / 2) * h))
                x2, y2 = int((x + bw / 2) * w), int((y + bh / 2) * h)
                crop = image[y1:y2, x1:x2]
                if crop.size:
                    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
                    plates.append(cv2.resize(rgb, (width, height), interpolation=cv2.INTER_LINEAR))
    if not plates:
        raise SystemExit(f"Sin placas etiquetadas en {dataset}")
    return np.stack(plates).astype(np.uint8)


def fold(onnx_path: Path, work: Path) -> Path:
    import onnx
    import onnxruntime

    model = onnx.load(str(onnx_path))
    for value in list(model.graph.input) + list(model.graph.output):
        value.type.tensor_type.shape.dim[0].dim_value = 1
    batch1 = work / "batch1.onnx"
    onnx.save(model, str(batch1))
    folded = work / "folded.onnx"
    options = onnxruntime.SessionOptions()
    options.graph_optimization_level = onnxruntime.GraphOptimizationLevel.ORT_ENABLE_BASIC
    options.optimized_model_filepath = str(folded)
    onnxruntime.InferenceSession(str(batch1), options, providers=["CPUExecutionProvider"])
    return folded


def to_torch(folded: Path, sample):
    import onnx
    import torch
    from onnx2torch import convert
    from onnx2torch.node_converters.reshape import OnnxReshape

    graph = convert(onnx.load(str(folded))).eval()

    class StaticReshape(torch.nn.Module):
        def __init__(self, shape):
            super().__init__()
            self.shape = shape

        def forward(self, data, *_):
            return data.reshape(self.shape)

    dynamic = [(name, module) for name, module in graph.named_modules()
               if isinstance(module, OnnxReshape) or "Squeeze" in type(module).__name__]
    shapes: dict[str, tuple[int, ...]] = {}
    hooks = [module.register_forward_hook(lambda m, i, o, name=name: shapes.__setitem__(name, tuple(o.shape)))
             for name, module in dynamic]
    with torch.no_grad():
        graph(sample)
    for hook in hooks:
        hook.remove()
    for name, _ in dynamic:
        setattr(graph, name, StaticReshape(shapes[name]))
    graph.recompile()

    with torch.no_grad():
        for module in graph.modules():
            tensors = list(module.named_parameters(recurse=False)) + list(module.named_buffers(recurse=False))
            for name, tensor in tensors:
                if tensor.is_contiguous():
                    continue
                fixed = tensor.detach().contiguous().clone()
                if isinstance(tensor, torch.nn.Parameter):
                    setattr(module, name, torch.nn.Parameter(fixed, requires_grad=False))
                else:
                    module.register_buffer(name, fixed)

    class PlateOnly(torch.nn.Module):
        """Solo la salida de caracteres; la de región no se usa."""

        def __init__(self, inner):
            super().__init__()
            self.inner = inner

        def forward(self, image):
            out = self.inner(image)
            return out[0] if isinstance(out, (tuple, list)) else out

    return PlateOnly(graph).eval()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--onnx", type=Path, default=MODELS / "plate-ocr.onnx")
    parser.add_argument("--config", type=Path, default=MODELS / "plate-ocr.yaml")
    parser.add_argument("--samples", type=Path, required=True, help="Dataset YOLO de recortes de vehículos con placas")
    parser.add_argument("--output", type=Path, required=True, help="Ruta sin extensión: crea .tflite y .json")
    args = parser.parse_args()

    import onnxruntime
    import torch
    import yaml
    import litert_torch
    from ai_edge_litert.interpreter import Interpreter

    config = yaml.safe_load(args.config.read_text(encoding="utf-8"))
    alphabet, pad, slots = config["alphabet"], config["pad_char"], int(config["max_plate_slots"])
    width, height = int(config["img_width"]), int(config["img_height"])
    samples = plate_samples(args.samples, width, height)
    sample = torch.from_numpy(samples[:1])

    with tempfile.TemporaryDirectory() as tmp:
        model = to_torch(fold(args.onnx, Path(tmp)), sample)
        target = args.output.with_suffix(".tflite")
        target.parent.mkdir(parents=True, exist_ok=True)
        litert_torch.convert(model, (sample,)).export(str(target))

    reference = onnxruntime.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
    interpreter = Interpreter(model_path=str(target))
    interpreter.allocate_tensors()
    tensor_in = interpreter.get_input_details()[0]
    tensor_out = interpreter.get_output_details()[0]

    def text(probabilities: np.ndarray) -> str:
        return "".join(alphabet[i] for i in probabilities.reshape(slots, len(alphabet)).argmax(-1)).rstrip(pad)

    same, worst = 0, 0.0
    for plate in samples:
        expected = reference.run(["plate"], {"input": plate[None]})[0]
        interpreter.set_tensor(tensor_in["index"], plate[None])
        interpreter.invoke()
        got = interpreter.get_tensor(tensor_out["index"])
        same += text(expected) == text(got)
        worst = max(worst, float(np.abs(expected - got).max()))
    print(f"Mismo texto que onnxruntime: {same}/{len(samples)} · diferencia máxima {worst:.1e}")
    if same != len(samples) or worst > 1e-3:
        raise SystemExit("El TFLite no reproduce el ONNX; no se escribe el manifiesto.")

    manifest = {
        "schema": "vigia-mobile-model/1",
        "task": "ocr",
        "source": args.onnx.name,
        "file": target.name,
        "sha256": hashlib.sha256(target.read_bytes()).hexdigest(),
        "input": {"shape": [int(v) for v in tensor_in["shape"]], "dtype": tensor_in["dtype"].__name__,
                  "layout": "NHWC", "range": [0, 255]},
        "output": {"shape": [int(v) for v in tensor_out["shape"]], "dtype": tensor_out["dtype"].__name__},
        "alphabet": alphabet,
        "padChar": pad,
        "slots": slots,
    }
    args.output.with_suffix(".json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Escrito {target} y {args.output.with_suffix('.json')}")


if __name__ == "__main__":
    main()
