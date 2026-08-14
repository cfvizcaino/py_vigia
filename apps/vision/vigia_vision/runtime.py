from __future__ import annotations

import os
import threading
import time
from collections.abc import Iterator
from typing import Any

from .config import Settings
from .events import TrackState, build_snapshot, update_tracks, utc_now, write_snapshot
from .plates import PlateDetection, annotate_plates, detect_plates, plate_class_ids, save_plate_capture

COCO_VEHICLE_CLASSES = [2, 3]


class VisionRuntime:
    """Mantiene el procesamiento de cámara fuera del ciclo HTTP de FastAPI."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._lock = threading.Lock()
        self._frame_condition = threading.Condition(self._lock)
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None
        self._status = "stopped"
        self._frame_number = 0
        self._last_frame_at: str | None = None
        self._last_frame_monotonic: float | None = None
        self._processing_fps = 0.0
        self._error_code: str | None = None
        self._latest_jpeg: bytes | None = None
        self._preview_version = 0
        self._tracks: dict[int, TrackState] = {}
        self._last_seen: dict[int, float] = {}
        self._plate_detections: list[PlateDetection] = []
        self._captured_plate_tracks: set[int] = set()
        self._plate_detection_enabled = False
        self._plate_error_code: str | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._run, name="vigia-camera-worker", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop_event.set()
        with self._frame_condition:
            self._frame_condition.notify_all()
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
                "processingFps": round(self._processing_fps, 1),
                "lastFrameAt": self._last_frame_at,
                "activeDetections": len(self._tracks),
                "activePlateDetections": len(self._plate_detections),
                "plateDetectionEnabled": self._plate_detection_enabled,
                "plateModel": os.path.basename(self.settings.plate_model) if self.settings.plate_model else None,
                "plateErrorCode": self._plate_error_code,
                "errorCode": self._error_code,
            }

    def detections(self) -> dict[str, Any]:
        with self._lock:
            return build_snapshot(self.settings.camera_id, self.settings.model, self._frame_number, self._tracks)

    def preview(self) -> bytes | None:
        with self._lock:
            return self._latest_jpeg

    def mjpeg_stream(self) -> Iterator[bytes]:
        """Entrega cada frame procesado una sola vez a cada cliente conectado."""
        last_version = 0
        while not self._stop_event.is_set():
            with self._frame_condition:
                self._frame_condition.wait_for(
                    lambda: self._preview_version != last_version or self._stop_event.is_set(),
                    timeout=5,
                )
                if self._stop_event.is_set():
                    return
                image = self._latest_jpeg
                version = self._preview_version

            if image is None or version == last_version:
                continue

            last_version = version
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n"
                + f"Content-Length: {len(image)}\r\n\r\n".encode()
                + image
                + b"\r\n"
            )

    def _set_status(self, status: str, error_code: str | None = None) -> None:
        with self._lock:
            self._status = status
            self._error_code = error_code

    def _set_plate_state(self, enabled: bool, error_code: str | None = None) -> None:
        with self._lock:
            self._plate_detection_enabled = enabled
            self._plate_error_code = error_code

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

        plate_model = None
        plate_classes: list[int] = []
        if self.settings.plate_model:
            try:
                plate_model = YOLO(self.settings.plate_model)
                plate_classes = plate_class_ids(plate_model)
                if not plate_classes:
                    plate_model = None
                    self._set_plate_state(False, "PLATE_CLASS_MISSING")
                else:
                    self._set_plate_state(True)
            except Exception:
                self._set_plate_state(False, "PLATE_MODEL_LOAD_ERROR")

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
                        next_frame_number = self._frame_number + 1

                    plate_detections: list[PlateDetection] = []
                    if plate_model and next_frame_number % self.settings.plate_every_n_frames == 0:
                        try:
                            plate_detections = detect_plates(
                                frame,
                                result,
                                plate_model,
                                plate_classes,
                                self.settings.plate_confidence,
                            )
                            self._set_plate_state(True)
                        except Exception:
                            self._set_plate_state(True, "PLATE_PROCESSING_ERROR")

                    with self._lock:
                        self._frame_number += 1
                        if self._last_frame_monotonic is not None:
                            instant_fps = 1 / max(now_monotonic - self._last_frame_monotonic, 0.001)
                            self._processing_fps = (
                                instant_fps
                                if not self._processing_fps
                                else (self._processing_fps * 0.85) + (instant_fps * 0.15)
                            )
                        self._last_frame_monotonic = now_monotonic
                        update_tracks(result, self._tracks, self._last_seen, now_monotonic, 10.0)
                        annotated = result.plot()
                        if plate_model and next_frame_number % self.settings.plate_every_n_frames == 0:
                            self._plate_detections = plate_detections
                        annotate_plates(annotated, plate_detections, cv2)
                        encoded, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 82])
                        if encoded:
                            self._latest_jpeg = buffer.tobytes()
                            self._preview_version += 1
                            self._frame_condition.notify_all()
                        self._last_frame_at = utc_now()
                        self._status = "running"
                        self._error_code = None
                        frame_number = self._frame_number
                        tracks_copy = dict(self._tracks)

                    for detection in plate_detections:
                        if detection.track_id is None or detection.track_id in self._captured_plate_tracks:
                            continue
                        if save_plate_capture(frame, detection, self.settings.plate_output, self.settings.camera_id, cv2):
                            self._captured_plate_tracks.add(detection.track_id)

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
