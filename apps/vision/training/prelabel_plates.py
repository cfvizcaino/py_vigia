"""Pre-etiqueta placas en una fuente de fotogramas para revisarlas, no para entrenar a ciegas.

Dos pasos, porque usan entornos distintos:

1. ``vehicles`` (entorno del nodo, Ultralytics): detecta vehículos con YOLO26n y guarda sus cajas.
2. ``plates`` (entorno con ``fast-alpr``, solo modelos ONNX, MIT): busca la placa dentro de
   cada vehículo con un detector público, la lee con ``fast-plate-ocr`` y escribe etiquetas
   YOLO (clase 0 = plate) más ``prelabels.json`` con lectura y confianza para revisar.

Los modelos ONNX no ejecutan código al cargarse, a diferencia de un ``.pt`` de terceros.
Las etiquetas son propuestas: se revisan en hojas de contacto antes de construir el dataset.

  .venv/bin/python training/prelabel_plates.py vehicles datasets/plates/source_placas_03
  <venv-alpr>/bin/python training/prelabel_plates.py plates datasets/plates/source_placas_03
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

VEHICLE_CLASSES = {2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


def _frames(source: Path) -> list[Path]:
    return sorted((source / "images" / "raw").glob("frame-*.jpg"))


def detect_vehicles(source: Path, model: str, imgsz: int, conf: float) -> dict:
    from ultralytics import YOLO

    detector = YOLO(model)
    vehicles = {}
    for image in _frames(source):
        result = detector.predict(str(image), imgsz=imgsz, conf=conf, classes=list(VEHICLE_CLASSES), verbose=False)[0]
        vehicles[image.name] = [
            {"box": [round(v, 1) for v in box], "label": VEHICLE_CLASSES[int(cls)], "score": round(float(score), 3)}
            for box, cls, score in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist(),
                                       strict=True)
        ]
    (source / "vehicles.json").write_text(json.dumps(vehicles) + "\n", encoding="utf-8")
    return vehicles


def _iou(a: list[float], b: list[float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def detect_plates(source: Path, detector_name: str, ocr_name: str, conf: float, margin: float) -> dict:
    import cv2
    from fast_alpr.default_detector import DefaultDetector
    from fast_alpr.default_ocr import DefaultOCR

    detector = DefaultDetector(model_name=detector_name, conf_thresh=conf)
    ocr = DefaultOCR(hub_ocr_model=ocr_name)
    vehicles = json.loads((source / "vehicles.json").read_text(encoding="utf-8"))
    labels_dir = source / "labels" / "raw"
    labels_dir.mkdir(parents=True, exist_ok=True)
    report = {}
    for image in _frames(source):
        frame = cv2.imread(str(image))
        height, width = frame.shape[:2]
        plates: list[dict] = []
        for vehicle in vehicles.get(image.name, []):
            x1, y1, x2, y2 = vehicle["box"]
            mx, my = (x2 - x1) * margin, (y2 - y1) * margin
            cx1, cy1 = max(0, int(x1 - mx)), max(0, int(y1 - my))
            cx2, cy2 = min(width, int(x2 + mx)), min(height, int(y2 + my))
            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                continue
            for found in detector.predict(crop):
                b = found.bounding_box
                box = [cx1 + b.x1, cy1 + b.y1, cx1 + b.x2, cy1 + b.y2]
                if any(_iou(box, other["box"]) > 0.5 for other in plates):
                    continue  # Same plate seen from two overlapping vehicle crops.
                px1, py1, px2, py2 = (int(round(v)) for v in box)
                plate_crop = frame[max(0, py1):py2, max(0, px1):px2]
                text, text_conf = None, None
                if plate_crop.size:
                    read = ocr.predict(plate_crop)
                    if read is not None:
                        text = read.text
                        confidence = read.confidence
                        text_conf = round(float(sum(confidence) / len(confidence)), 3) if isinstance(confidence, list) \
                            else round(float(confidence), 3)
                plates.append({"box": [round(v, 1) for v in box], "score": round(float(found.confidence), 3),
                               "vehicle": vehicle["label"], "width_px": round(box[2] - box[0], 1),
                               "text": text, "text_confidence": text_conf})
        lines = [
            f"0 {((p['box'][0] + p['box'][2]) / 2) / width:.6f} {((p['box'][1] + p['box'][3]) / 2) / height:.6f} "
            f"{(p['box'][2] - p['box'][0]) / width:.6f} {(p['box'][3] - p['box'][1]) / height:.6f}"
            for p in plates
        ]
        (labels_dir / f"{image.stem}.txt").write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
        report[image.name] = plates
    (source / "prelabels.json").write_text(json.dumps(report, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    veh = commands.add_parser("vehicles")
    veh.add_argument("source", type=Path)
    veh.add_argument("--model", default="yolo26n.pt")
    veh.add_argument("--imgsz", type=int, default=1280)
    veh.add_argument("--conf", type=float, default=0.25)
    pla = commands.add_parser("plates")
    pla.add_argument("source", type=Path)
    pla.add_argument("--detector", default="yolo-v9-s-608-license-plate-end2end")
    pla.add_argument("--ocr", default="cct-s-v2-global-model")
    pla.add_argument("--conf", type=float, default=0.3)
    pla.add_argument("--margin", type=float, default=0.1, help="Margen alrededor del vehículo (fracción)")
    args = parser.parse_args()
    if args.command == "vehicles":
        found = detect_vehicles(args.source, args.model, args.imgsz, args.conf)
        print(json.dumps({"frames": len(found), "vehicles": sum(len(v) for v in found.values())}))
    else:
        found = detect_plates(args.source, args.detector, args.ocr, args.conf, args.margin)
        plates = [p for v in found.values() for p in v]
        print(json.dumps({"frames": len(found), "plates": len(plates),
                          "frames_with_plates": sum(1 for v in found.values() if v),
                          "read": sum(1 for p in plates if p["text"])}))


if __name__ == "__main__":
    main()
