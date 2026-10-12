"""Mide la fragmentación del seguimiento: cuántas veces un mismo vehículo nace como track nuevo.

Sin etiquetas manuales, usa una aproximación: un track que empieza a menos de
``--gap`` segundos de que otro de la misma clase terminara, y cerca de donde ese otro
se vio por última vez, cuenta como fragmento (el mismo vehículo, perdido y recreado).

  # Nodo PC: seguimiento de Ultralytics con la configuración indicada
  .venv/bin/python training/evaluate_tracking.py pc captures/video.mp4 --tracker vigia_vision/trackers/vigia-bytetrack.yaml --conf 0.1
  # Teléfono: detecciones a 320 px y ~6 análisis/s para el rastreador de la app
  .venv/bin/python training/evaluate_tracking.py record captures/video.mp4 --output detecciones.json
  # Métricas de un archivo de tracks (lo escribe `pc` o apps/movil/tool/track_report.dart)
  .venv/bin/python training/evaluate_tracking.py metrics tracks.json
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import median

VEHICLES = {2: "car", 3: "motorcycle"}


def _iou(a: list[float], b: list[float]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def _near(a: list[float], b: list[float]) -> bool:
    """Misma zona: se solapan, o los centros están a menos de un ancho de caja."""
    if _iou(a, b) > 0.1:
        return True
    ax, ay = (a[0] + a[2]) / 2, (a[1] + a[3]) / 2
    bx, by = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    size = max(a[2] - a[0], a[3] - a[1], b[2] - b[0], b[3] - b[1])
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5 < size


def metrics(tracks: list[dict], gap: float = 5.0) -> dict:
    """``tracks``: [{"id", "label", "first", "last" (s), "firstBox", "lastBox"}]."""
    lives = [t["last"] - t["first"] for t in tracks]
    fragments = 0
    ordered = sorted(tracks, key=lambda t: t["first"])
    for i, track in enumerate(ordered):
        for previous in ordered[:i]:
            ended_before = 0 <= track["first"] - previous["last"] <= gap
            if ended_before and previous["label"] == track["label"] and _near(previous["lastBox"], track["firstBox"]):
                fragments += 1
                break
    return {
        "tracks": len(tracks),
        "fragmentos": fragments,
        "tracks_sin_fragmentos": len(tracks) - fragments,
        "menos_de_2s": sum(life < 2 for life in lives),
        "vida_mediana_s": round(median(lives), 1) if lives else 0,
    }


def _sampled_frames(video: Path, analyses_per_second: float):
    import cv2

    capture = cv2.VideoCapture(str(video))
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    step = max(1, round(fps / analyses_per_second))
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        if index % step == 0:
            yield index / fps, frame
        index += 1
    capture.release()


def run_pc(video: Path, tracker: str, conf: float, rate: float, report_conf: float) -> list[dict]:
    from ultralytics import YOLO

    model = YOLO("yolo26n.pt")
    tracks: dict[int, dict] = {}
    for seconds, frame in _sampled_frames(video, rate):
        result = model.track(frame, persist=True, tracker=tracker, classes=list(VEHICLES), conf=conf, verbose=False)[0]
        if result.boxes is None or result.boxes.id is None:
            continue
        for box, track_id, cls, score in zip(result.boxes.xyxy.tolist(), result.boxes.id.int().tolist(),
                                             result.boxes.cls.int().tolist(), result.boxes.conf.tolist(), strict=True):
            track = tracks.setdefault(track_id, {"id": track_id, "label": VEHICLES[cls], "first": seconds,
                                                 "firstBox": box, "best": 0.0})
            track.update(last=seconds, lastBox=box, best=max(track["best"], score))
    # What the node would publish: tracks that reached the reporting confidence once.
    return [t for t in tracks.values() if t["best"] >= report_conf]


def record(video: Path, rate: float, imgsz: int) -> dict:
    from ultralytics import YOLO

    model = YOLO("yolo26n.pt")
    frames = []
    for seconds, frame in _sampled_frames(video, rate):
        result = model.predict(frame, imgsz=imgsz, conf=0.05, classes=list(VEHICLES), verbose=False)[0]
        frames.append({
            "t": round(seconds, 3),
            "detections": [
                {"box": [round(v, 1) for v in box], "score": round(score, 4), "label": VEHICLES[cls]}
                for box, score, cls in zip(result.boxes.xyxy.tolist(), result.boxes.conf.tolist(),
                                           result.boxes.cls.int().tolist(), strict=True)
            ],
        })
    return {"video": video.name, "rate": rate, "imgsz": imgsz, "frames": frames}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    pc = commands.add_parser("pc")
    pc.add_argument("video", type=Path)
    pc.add_argument("--tracker", default="bytetrack.yaml")
    pc.add_argument("--conf", type=float, default=0.35, help="Umbral que recibe el rastreador")
    pc.add_argument("--report-conf", type=float, default=0.35, help="Confianza mínima para publicar un track")
    pc.add_argument("--rate", type=float, default=8, help="Análisis por segundo (el nodo procesa ~6-10)")
    pc.add_argument("--output", type=Path)
    rec = commands.add_parser("record")
    rec.add_argument("video", type=Path)
    rec.add_argument("--output", type=Path, required=True)
    rec.add_argument("--rate", type=float, default=6, help="Análisis por segundo del teléfono")
    rec.add_argument("--imgsz", type=int, default=320)
    met = commands.add_parser("metrics")
    met.add_argument("tracks", type=Path)
    args = parser.parse_args()

    if args.command == "pc":
        tracks = run_pc(args.video, args.tracker, args.conf, args.rate, args.report_conf)
        if args.output:
            args.output.write_text(json.dumps(tracks) + "\n", encoding="utf-8")
        print(json.dumps(metrics(tracks), ensure_ascii=False))
    elif args.command == "record":
        args.output.write_text(json.dumps(record(args.video, args.rate, args.imgsz)) + "\n", encoding="utf-8")
    else:
        print(json.dumps(metrics(json.loads(args.tracks.read_text(encoding="utf-8"))), ensure_ascii=False))


if __name__ == "__main__":
    main()
