"""Lectura de la placa: OCR sobre la caja que da el detector, votado entre cuadros por track.

Modelo: ``cct-xs-v2-global`` de fast-plate-ocr (ONNX, MIT), el mejor de los medidos con
placas de 45 px o más (docs/modeling/license-plates.md). No se usa el paquete
``fast-plate-ocr`` porque arrastra ``opencv-python-headless``, que choca con el
``opencv-python`` del nodo; su pre y posproceso son pocos pasos y se replican aquí:
BGR→RGB, redimensionar a la entrada del modelo y tomar el carácter más probable de cada
posición, quitando el relleno.

Igual que el color, un cuadro engaña: cada track junta lecturas y solo reporta un texto
cuando se repite. Las lecturas que no tienen formato de placa colombiana se descartan.
Mejor "desconocida" que una placa equivocada, que señalaría a otro vehículo.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .plates import PlateDetection

# Below ~45 px wide fewer than 40 % of the plates were read whole (test of 13/10/2026).
MIN_PLATE_WIDTH_PX = 45
MIN_CHAR_CONFIDENCE = 0.5
MIN_VOTES = 2
MAX_READS = 6
MAX_READS_PER_FRAME = 3
# Particular/público: ABC123. Motos: ABC12 (antiguas) o ABC12D.
COLOMBIAN_PLATE = re.compile(r"[A-Z]{3}[0-9]{3}|[A-Z]{3}[0-9]{2}[A-Z]?")


@dataclass
class PlateReads:
    texts: Counter[str] = field(default_factory=Counter)
    reads: int = 0

    def add(self, text: str | None) -> None:
        """Cuenta una lectura; ``None`` (ilegible o sin formato) cuenta como intento."""
        self.reads += 1
        if text:
            self.texts[text] += 1

    @property
    def plate(self) -> str | None:
        ranked = self.texts.most_common(2)
        if not ranked or ranked[0][1] < MIN_VOTES:
            return None
        if len(ranked) > 1 and ranked[1][1] == ranked[0][1]:
            return None  # Tie between two texts: neither is trustworthy.
        return ranked[0][0]

    def wants_read(self) -> bool:
        return self.reads < MAX_READS


def valid_plate(text: str) -> bool:
    return COLOMBIAN_PLATE.fullmatch(text) is not None


class PlateReader:
    """Sesión ONNX con la configuración de fast-plate-ocr (``<modelo>.yaml`` al lado)."""

    def __init__(self, model_path: str, config_path: str | None = None) -> None:
        import onnxruntime
        import yaml

        config_file = Path(config_path) if config_path else Path(model_path).with_suffix(".yaml")
        config = yaml.safe_load(config_file.read_text(encoding="utf-8"))
        if config.get("keep_aspect_ratio") or config.get("image_color_mode", "grayscale") != "rgb":
            raise ValueError("Solo se admiten modelos RGB sin conservar la proporción (cct-xs-v2-global)")
        self.alphabet: str = config["alphabet"]
        self.pad_char: str = config["pad_char"]
        self.slots: int = int(config["max_plate_slots"])
        self.size = (int(config["img_width"]), int(config["img_height"]))
        self.session = onnxruntime.InferenceSession(model_path, providers=["CPUExecutionProvider"])
        outputs = [output.name for output in self.session.get_outputs()]
        self.output_name = "plate" if "plate" in outputs else outputs[0]
        self.input_name = self.session.get_inputs()[0].name

    def read(self, plates: list[Any]) -> list[tuple[str, float]]:
        """Texto y confianza mínima por carácter de cada recorte BGR."""
        import cv2
        import numpy as np

        batch = np.stack([
            cv2.resize(cv2.cvtColor(plate, cv2.COLOR_BGR2RGB), self.size, interpolation=cv2.INTER_LINEAR)
            for plate in plates
        ]).astype(np.uint8)
        output = self.session.run([self.output_name], {self.input_name: batch})[0]
        return decode(output, self.alphabet, self.slots, self.pad_char)


def decode(output: Any, alphabet: str, slots: int, pad_char: str) -> list[tuple[str, float]]:
    """Carácter más probable por posición; la confianza es la del carácter más dudoso."""
    import numpy as np

    probabilities = np.asarray(output).reshape((-1, slots, len(alphabet)))
    indices = probabilities.argmax(axis=-1)
    confidences = probabilities.max(axis=-1)
    reads = []
    for row, scores in zip(indices, confidences, strict=True):
        text = "".join(alphabet[index] for index in row).rstrip(pad_char)
        kept = scores[: len(text)]
        reads.append((text, float(kept.min()) if len(kept) else 0.0))
    return reads


def read_tracks(
    reader: Any,
    frame: Any,
    detections: list[PlateDetection],
    reads: dict[int, PlateReads],
) -> None:
    """Lee las placas suficientemente grandes de los tracks que aún necesitan lecturas.

    Una placa a la que se asocian dos tracks (vehículos solapados) no se lee: no se sabe de
    cuál es. De cada track se toma la placa más confiable del cuadro.
    """
    best: dict[int, PlateDetection] = {}
    for detection in detections:
        if detection.track_id is None:
            continue
        current = best.get(detection.track_id)
        if current is None or detection.confidence > current.confidence:
            best[detection.track_id] = detection
    shared = {
        track_id
        for track_id, detection in best.items()
        for other_id, other in best.items()
        if other_id != track_id and _iou(detection.bounding_box, other.bounding_box) > 0.5
    }
    pending = sorted(
        (
            detection for track_id, detection in best.items()
            if track_id not in shared
            and detection.bounding_box[2] - detection.bounding_box[0] >= MIN_PLATE_WIDTH_PX
            and reads.setdefault(track_id, PlateReads()).wants_read()
        ),
        key=lambda detection: reads[detection.track_id].reads,
    )[:MAX_READS_PER_FRAME]
    selected = []
    for detection in pending:
        x1, y1, x2, y2 = detection.bounding_box
        image = frame[y1:y2, x1:x2]
        if image.size:
            selected.append((detection, image))
    if not selected:
        return
    texts = reader.read([image for _, image in selected])
    for (detection, _), (text, confidence) in zip(selected, texts, strict=True):
        ok = confidence >= MIN_CHAR_CONFIDENCE and valid_plate(text)
        reads[detection.track_id].add(text if ok else None)


def prune(reads: dict[int, PlateReads], live_track_ids: set[int]) -> None:
    for track_id in [track_id for track_id in reads if track_id not in live_track_ids]:
        del reads[track_id]


def _iou(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> float:
    w = min(a[2], b[2]) - max(a[0], b[0])
    h = min(a[3], b[3]) - max(a[1], b[1])
    if w <= 0 or h <= 0:
        return 0.0
    inter = w * h
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)
