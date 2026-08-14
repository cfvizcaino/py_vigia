from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class PlateDetection:
    track_id: int | None
    confidence: float
    bounding_box: tuple[int, int, int, int]


def plate_class_ids(model: Any) -> list[int]:
    names = model.names
    items = names.items() if isinstance(names, dict) else enumerate(names)
    return [class_id for class_id, name in items if any(term in str(name).lower() for term in ("plate", "placa"))]


def detect_plates(
    frame: Any,
    vehicle_result: Any,
    model: Any,
    class_ids: list[int],
    confidence: float,
) -> list[PlateDetection]:
    """Busca placas dentro de cada vehículo y devuelve coordenadas del frame completo."""
    boxes = vehicle_result.boxes
    if boxes is None or len(boxes) == 0:
        return []

    height, width = frame.shape[:2]
    vehicle_boxes = boxes.xyxy.cpu().tolist()
    track_ids = boxes.id.int().cpu().tolist() if boxes.id is not None else [None] * len(vehicle_boxes)
    detections: list[PlateDetection] = []

    for vehicle_box, track_id in zip(vehicle_boxes, track_ids, strict=True):
        x1, y1, x2, y2 = vehicle_box
        padding_x = (x2 - x1) * 0.04
        padding_y = (y2 - y1) * 0.04
        crop_x1 = max(0, round(x1 - padding_x))
        crop_y1 = max(0, round(y1 - padding_y))
        crop_x2 = min(width, round(x2 + padding_x))
        crop_y2 = min(height, round(y2 + padding_y))
        if crop_x2 - crop_x1 < 40 or crop_y2 - crop_y1 < 25:
            continue

        crop = frame[crop_y1:crop_y2, crop_x1:crop_x2]
        plate_result = model.predict(
            crop,
            classes=class_ids,
            conf=confidence,
            imgsz=640,
            verbose=False,
        )[0]
        if plate_result.boxes is None:
            continue

        for plate_box, score in zip(
            plate_result.boxes.xyxy.cpu().tolist(),
            plate_result.boxes.conf.cpu().tolist(),
            strict=True,
        ):
            px1, py1, px2, py2 = plate_box
            detections.append(
                PlateDetection(
                    track_id=track_id,
                    confidence=round(float(score), 4),
                    bounding_box=(
                        max(0, round(crop_x1 + px1)),
                        max(0, round(crop_y1 + py1)),
                        min(width, round(crop_x1 + px2)),
                        min(height, round(crop_y1 + py2)),
                    ),
                )
            )

    return detections


def annotate_plates(image: Any, detections: list[PlateDetection], cv2: Any) -> None:
    for detection in detections:
        x1, y1, x2, y2 = detection.bounding_box
        cv2.rectangle(image, (x1, y1), (x2, y2), (42, 196, 255), 2)
        cv2.putText(
            image,
            f"placa {detection.confidence:.2f}",
            (x1, max(18, y1 - 6)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.55,
            (42, 196, 255),
            2,
            cv2.LINE_AA,
        )


def save_plate_capture(frame: Any, detection: PlateDetection, output: Path, camera_id: str, cv2: Any) -> Path | None:
    if detection.track_id is None:
        return None
    x1, y1, x2, y2 = detection.bounding_box
    crop = frame[y1:y2, x1:x2]
    if crop.size == 0:
        return None
    output.mkdir(parents=True, exist_ok=True)
    path = output / f"{camera_id}-track-{detection.track_id}.jpg"
    return path if cv2.imwrite(str(path), crop) else None
