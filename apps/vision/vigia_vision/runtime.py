from __future__ import annotations

import os
import threading
import time
from typing import Any

from .config import Settings
from .events import TrackState, build_snapshot, update_tracks, utc_now, write_snapshot

COCO_VEHICLE_CLASSES = [2, 3]


class VisionRuntime:
    """Mantiene el procesamiento de cámara fuera del ciclo HTTP de FastAPI."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._status = "stopped"
        self._frame_number = 0
        self._last_frame_at: str | None = None
        self._error_code: str | None = None
        self._latest_jpeg: bytes | None = None
        self._tracks: dict[int, TrackState] = {}
        self._last_seen: dict[int, float] = {}

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="vigia-camera-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=8)
        with self._lock:
            self._status = "stopped"

    def status(self) -> dict[str, Any]:
        with self._lock:
            return {
                "service": "vigia-vision",
                "status": self._status,
                "cameraId": self.settings.camera_id,
                "cameraModel": "Tapo C110",
                "model": self.settings.model,
                "frameNumber": self._frame_number,
                "lastFrameAt": self._last_frame_at,
                "activeDetections": len(self._tracks),
                "errorCode": self._error_code,
            }

    def detections(self) -> dict[str, Any]:
        with self._lock:
            return build_snapshot(self.settings.camera_id, self.settings.model, self._frame_number, self._tracks)

    def preview(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def _set_status(self, status: str, error_code: str | None = None) -> None:
        with self._lock:
            self._status = status
            self._error_code = error_code

    def _run(self) -> None:
        try:
            import cv2
            from ultralytics import YOLO
        except ImportError:
            self._set_status("error", "DEPENDENCY_ERROR")
            return

        self._set_status("loading-model")
        try:
            model = YOLO(self.settings.model)
        except Exception:
            self._set_status("error", "MODEL_LOAD_ERROR")
            return

        os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
        last_write = 0.0

        while not self._stop_event.is_set():
            self._set_status("connecting")
            capture = cv2.VideoCapture(self.settings.rtsp_url(), cv2.CAP_FFMPEG)
            if not capture.isOpened():
                capture.release()
                self._set_status("reconnecting", "CAMERA_UNAVAILABLE")
                self._stop_event.wait(4)
                continue

            self._set_status("running")
            failed_reads = 0
            try:
                while not self._stop_event.is_set():
                    ok, frame = capture.read()
                    if not ok:
                        failed_reads += 1
                        if failed_reads >= 20:
                            break
                        continue

                    failed_reads = 0
                    result = model.track(
                        frame,
                        persist=True,
                        tracker="bytetrack.yaml",
                        classes=COCO_VEHICLE_CLASSES,
                        conf=self.settings.confidence,
                        verbose=False,
                    )[0]
                    now_monotonic = time.monotonic()

                    with self._lock:
                        self._frame_number += 1
                        update_tracks(result, self._tracks, self._last_seen, now_monotonic, 10.0)
                        annotated = result.plot()
                        encoded, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 82])
                        if encoded:
                            self._latest_jpeg = buffer.tobytes()
                        self._last_frame_at = utc_now()
                        self._status = "running"
                        self._error_code = None
                        frame_number = self._frame_number
                        tracks_copy = dict(self._tracks)

                    if now_monotonic - last_write >= 2:
                        write_snapshot(self.settings.output, self.settings.camera_id, self.settings.model, frame_number, tracks_copy)
                        last_write = now_monotonic
            except Exception:
                self._set_status("reconnecting", "PROCESSING_ERROR")
            finally:
                capture.release()

            if not self._stop_event.is_set():
                self._set_status("reconnecting", "STREAM_INTERRUPTED")
                self._stop_event.wait(2)

        with self._lock:
            tracks_copy = dict(self._tracks)
            frame_number = self._frame_number
        write_snapshot(self.settings.output, self.settings.camera_id, self.settings.model, frame_number, tracks_copy)
