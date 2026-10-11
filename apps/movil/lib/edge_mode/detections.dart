import 'dart:math' as math;
import 'dart:typed_data';

import 'preprocess.dart';

/// A box in upright frame pixels.
class Box {
  const Box(this.x1, this.y1, this.x2, this.y2);

  final double x1;
  final double y1;
  final double x2;
  final double y2;

  double get width => math.max(0, x2 - x1);
  double get height => math.max(0, y2 - y1);
  double get area => width * height;
  (double, double) get center => ((x1 + x2) / 2, (y1 + y2) / 2);

  double iou(Box other) {
    final w = math.min(x2, other.x2) - math.max(x1, other.x1);
    final h = math.min(y2, other.y2) - math.max(y1, other.y1);
    if (w <= 0 || h <= 0) return 0;
    final intersection = w * h;
    return intersection / (area + other.area - intersection);
  }

  List<int> toList() => [x1.round(), y1.round(), x2.round(), y2.round()];
}

class Detection {
  const Detection({
    required this.box,
    required this.score,
    required this.label,
  });

  final Box box;
  final double score;

  /// Contract label (`car`, `motorcycle`; later `plate`).
  final String label;
}

/// Class index → contract label. COCO: 2 car, 3 motorcycle. A plate model will
/// bring its own map; classes not listed are ignored.
const cocoVehicleLabels = {2: 'car', 3: 'motorcycle'};

/// Decodes a YOLO TFLite output into upright-frame detections.
///
/// - End-to-end (YOLO26, NMS-free): shape `[1, N, 6]` = x1, y1, x2, y2, score, class.
/// - Classic (YOLOv8/11): shape `[1, 4 + classes, anchors]` = cx, cy, w, h, scores…
///   followed by per-class NMS.
///
/// Coordinates may come normalized (0–1) or in input pixels; both are handled.
List<Detection> decodeYolo({
  required Float32List output,
  required List<int> shape,
  required Letterbox letterbox,
  Map<int, String> labels = cocoVehicleLabels,
  double minScore = 0.35,
  double iouThreshold = 0.5,
}) {
  if (shape.length != 3 || shape[0] != 1) {
    throw ArgumentError('Salida de modelo no soportada: $shape');
  }
  final raw = <Detection>[];
  final size = letterbox.size.toDouble();
  if (shape[2] == 6) {
    final rows = shape[1];
    final normalized = _looksNormalized(output, rows, 6, const [0, 1, 2, 3]);
    final factor = normalized ? size : 1.0;
    for (var row = 0; row < rows; row++) {
      final base = row * 6;
      final score = output[base + 4];
      if (score < minScore) continue;
      final label = labels[output[base + 5].round()];
      if (label == null) continue;
      raw.add(
        _toDetection(
          output[base] * factor,
          output[base + 1] * factor,
          output[base + 2] * factor,
          output[base + 3] * factor,
          score,
          label,
          letterbox,
        ),
      );
    }
    return raw; // Already de-duplicated by the model.
  }

  final channels = shape[1];
  final anchors = shape[2];
  if (channels < 5) {
    throw ArgumentError('Salida de modelo no soportada: $shape');
  }
  final normalized = _looksNormalizedChannelsFirst(output, anchors);
  final factor = normalized ? size : 1.0;
  for (var a = 0; a < anchors; a++) {
    var best = 0.0;
    var bestClass = -1;
    for (var c = 4; c < channels; c++) {
      final value = output[c * anchors + a];
      if (value > best) {
        best = value;
        bestClass = c - 4;
      }
    }
    if (best < minScore) continue;
    final label = labels[bestClass];
    if (label == null) continue;
    final cx = output[a] * factor;
    final cy = output[anchors + a] * factor;
    final w = output[2 * anchors + a] * factor;
    final h = output[3 * anchors + a] * factor;
    raw.add(
      _toDetection(
        cx - w / 2,
        cy - h / 2,
        cx + w / 2,
        cy + h / 2,
        best,
        label,
        letterbox,
      ),
    );
  }
  return nonMaxSuppression(raw, iouThreshold);
}

Detection _toDetection(
  double x1,
  double y1,
  double x2,
  double y2,
  double score,
  String label,
  Letterbox letterbox,
) {
  final (ux1, uy1) = letterbox.toUpright(x1, y1);
  final (ux2, uy2) = letterbox.toUpright(x2, y2);
  final maxX = letterbox.uprightWidth.toDouble();
  final maxY = letterbox.uprightHeight.toDouble();
  return Detection(
    box: Box(
      ux1.clamp(0, maxX),
      uy1.clamp(0, maxY),
      ux2.clamp(0, maxX),
      uy2.clamp(0, maxY),
    ),
    score: score,
    label: label,
  );
}

/// Greedy per-label NMS, highest score first.
List<Detection> nonMaxSuppression(
  List<Detection> detections,
  double iouThreshold,
) {
  final sorted = [...detections]..sort((a, b) => b.score.compareTo(a.score));
  final kept = <Detection>[];
  for (final candidate in sorted) {
    if (kept.every(
      (k) =>
          k.label != candidate.label || k.box.iou(candidate.box) < iouThreshold,
    )) {
      kept.add(candidate);
    }
  }
  return kept;
}

bool _looksNormalized(
  Float32List output,
  int rows,
  int stride,
  List<int> columns,
) {
  var maxValue = 0.0;
  for (var row = 0; row < rows; row++) {
    for (final column in columns) {
      maxValue = math.max(maxValue, output[row * stride + column].abs());
    }
  }
  return maxValue <= 1.5;
}

bool _looksNormalizedChannelsFirst(Float32List output, int anchors) {
  var maxValue = 0.0;
  for (var i = 0; i < 4 * anchors; i++) {
    maxValue = math.max(maxValue, output[i].abs());
  }
  return maxValue <= 1.5;
}
