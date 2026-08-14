from __future__ import annotations

import argparse
import time
from pathlib import Path

from .config import Settings
from .events import TrackState, update_tracks, write_snapshot

COCO_VEHICLE_CLASSES = [2, 3]  # car, motorcycle


def parse_source(value: str | None, settings: Settings) -> str | int:
    if value is None:
        return settings.rtsp_url()
    return int(value) if value.isdigit() else value


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Detección y tracking vehicular para VIGIA")
    parser.add_argument("--source", help="Ruta de video, URL RTSP o índice de webcam. Si se omite, usa la Tapo configurada.")
    parser.add_argument("--model", help="Modelo YOLO; reemplaza YOLO_MODEL.")
    parser.add_argument("--output", type=Path, help="Ruta del snapshot JSON.")
    parser.add_argument("--confidence", type=float, help="Confianza mínima entre 0 y 1.")
    parser.add_argument("--max-frames", type=int, default=0, help="Detenerse después de N frames; 0 procesa indefinidamente.")
    parser.add_argument("--write-every", type=float, default=2.0, help="Segundos entre actualizaciones del JSON.")
    parser.add_argument("--retention", type=float, default=10.0, help="Segundos que un track permanece en el snapshot.")
    return parser


def run(args: argparse.Namespace) -> None:
    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise SystemExit("Falta Ultralytics. Ejecuta: pip install -r requirements.txt") from error

    settings = Settings.from_environment()
    model_name = args.model or settings.model
    output = args.output or settings.output
    confidence = args.confidence if args.confidence is not None else settings.confidence
    if not 0 < confidence <= 1:
        raise SystemExit("--confidence debe estar entre 0 y 1")

    source = parse_source(args.source, settings)
    source_description = "Tapo RTSP configurada" if args.source is None else str(source)
    print(f"VIGIA iniciando | cámara={settings.camera_id} | fuente={source_description} | modelo={model_name}")

    model = YOLO(model_name)
    results = model.track(
        source=source,
        stream=True,
        persist=True,
        tracker="bytetrack.yaml",
        classes=COCO_VEHICLE_CLASSES,
        conf=confidence,
        verbose=False,
    )

    tracks: dict[int, TrackState] = {}
    last_seen_monotonic: dict[int, float] = {}
    last_write = 0.0

    try:
        for frame_number, result in enumerate(results, start=1):
            now_monotonic = time.monotonic()
            update_tracks(result, tracks, last_seen_monotonic, now_monotonic, args.retention)

            if now_monotonic - last_write >= args.write_every:
                write_snapshot(output, settings.camera_id, model_name, frame_number, tracks)
                print(f"frame={frame_number} | tracks_activos={len(tracks)} | salida={output}")
                last_write = now_monotonic

            if args.max_frames and frame_number >= args.max_frames:
                break
    except KeyboardInterrupt:
        print("Detención solicitada por el usuario.")
    finally:
        final_frame = locals().get("frame_number", 0)
        write_snapshot(output, settings.camera_id, model_name, final_frame, tracks)
        print(f"Snapshot final guardado en {output}")


def main() -> None:
    run(build_parser().parse_args())
