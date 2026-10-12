import 'dart:math' as math;
import 'dart:typed_data';

import '../camera_mode/frame_encoder.dart';

/// Where the upright frame landed inside the square model input.
class Letterbox {
  const Letterbox({
    required this.size,
    required this.scale,
    required this.padX,
    required this.padY,
    required this.uprightWidth,
    required this.uprightHeight,
  });

  final int size;
  final double scale;
  final double padX;
  final double padY;
  final int uprightWidth;
  final int uprightHeight;

  /// Model-input coordinates → upright frame pixels.
  (double, double) toUpright(double x, double y) =>
      (((x - padX) / scale), ((y - padY) / scale));
}

class ModelInput {
  const ModelInput(this.pixels, this.letterbox);

  /// Float32 RGB in [0, 1], `size × size × 3`, NHWC or NCHW as requested.
  final Float32List pixels;
  final Letterbox letterbox;
}

class PreprocessRequest {
  const PreprocessRequest(this.frame, this.size, {this.channelsFirst = false});

  final FrameData frame;
  final int size;

  /// NCHW (models exported by litert_torch) instead of NHWC.
  final bool channelsFirst;
}

const _padValue = 114 / 255; // Ultralytics letterbox gray.

/// Rotates the camera frame upright and letterboxes it into the model input in
/// one pass (nearest-neighbour). Top-level so it can run in an isolate.
ModelInput prepareInput(PreprocessRequest request) {
  final frame = request.frame;
  final size = request.size;
  final rotation = ((frame.rotationDegrees % 360) + 360) % 360;
  final turned = rotation == 90 || rotation == 270;
  final uprightWidth = turned ? frame.height : frame.width;
  final uprightHeight = turned ? frame.width : frame.height;
  final scale = math.min(size / uprightWidth, size / uprightHeight);
  final contentWidth = (uprightWidth * scale).round();
  final contentHeight = (uprightHeight * scale).round();
  final padX = (size - contentWidth) / 2;
  final padY = (size - contentHeight) / 2;
  final left = padX.floor();
  final top = padY.floor();

  final out = Float32List(size * size * 3)
    ..fillRange(0, size * size * 3, _padValue);
  final sampler = _Sampler(frame);
  final plane = size * size;
  // Offset between R, G and B of one pixel, and between neighbouring pixels.
  final channelStride = request.channelsFirst ? plane : 1;
  final pixelStride = request.channelsFirst ? 1 : 3;
  for (var oy = 0; oy < contentHeight; oy++) {
    final uy = math.min(((oy + 0.5) / scale).floor(), uprightHeight - 1);
    var index = ((top + oy) * size + left) * pixelStride;
    for (var ox = 0; ox < contentWidth; ox++) {
      final ux = math.min(((ox + 0.5) / scale).floor(), uprightWidth - 1);
      // Upright (ux, uy) → sensor (sx, sy) for a clockwise `rotation`.
      final int sx, sy;
      switch (rotation) {
        case 90:
          sx = uy;
          sy = frame.height - 1 - ux;
        case 180:
          sx = frame.width - 1 - ux;
          sy = frame.height - 1 - uy;
        case 270:
          sx = frame.width - 1 - uy;
          sy = ux;
        default:
          sx = ux;
          sy = uy;
      }
      sampler.write(sx, sy, out, index, channelStride);
      index += pixelStride;
    }
  }
  return ModelInput(
    out,
    Letterbox(
      size: size,
      scale: scale,
      padX: left.toDouble(),
      padY: top.toDouble(),
      uprightWidth: uprightWidth,
      uprightHeight: uprightHeight,
    ),
  );
}

class CropRequest {
  const CropRequest(
    this.frame,
    this.box,
    this.size, {
    this.channelsFirst = false,
  });

  final FrameData frame;

  /// Upright-frame pixels: x1, y1, x2, y2.
  final (double, double, double, double) box;
  final int size;
  final bool channelsFirst;
}

/// A box's centred square, resized to the classifier input: the same view as
/// Ultralytics' classify transform (resize the short side, centre crop), with
/// the same antialiased bilinear filter as PIL/torchvision. Nearest-neighbour
/// here costs about 4 points of accuracy on the test set.
Float32List prepareCrop(CropRequest request) {
  final frame = request.frame;
  final size = request.size;
  final rotation = ((frame.rotationDegrees % 360) + 360) % 360;
  final turned = rotation == 90 || rotation == 270;
  final uprightWidth = turned ? frame.height : frame.width;
  final uprightHeight = turned ? frame.width : frame.height;
  final (x1, y1, x2, y2) = request.box;
  final side = math.max(
    1,
    math.min(
      math.min(x2 - x1, y2 - y1).round(),
      math.min(uprightWidth, uprightHeight),
    ),
  );
  final left = (x1 + (x2 - x1 - side) / 2).round().clamp(
    0,
    uprightWidth - side,
  );
  final top = (y1 + (y2 - y1 - side) / 2).round().clamp(
    0,
    uprightHeight - side,
  );

  // 1. The square at full resolution, upright RGB (interleaved).
  final square = Float32List(side * side * 3);
  final sampler = _Sampler(frame);
  for (var y = 0; y < side; y++) {
    final uy = top + y;
    for (var x = 0; x < side; x++) {
      final ux = left + x;
      final (sx, sy) = switch (rotation) {
        90 => (uy, frame.height - 1 - ux),
        180 => (frame.width - 1 - ux, frame.height - 1 - uy),
        270 => (frame.width - 1 - uy, ux),
        _ => (ux, uy),
      };
      sampler.write(sx, sy, square, (y * side + x) * 3, 1);
    }
  }

  // 2. Separable resize: rows to `size` columns, then columns to `size` rows.
  final taps = _bilinearTaps(side, size);
  final rows = Float32List(side * size * 3);
  for (var y = 0; y < side; y++) {
    for (var ox = 0; ox < size; ox++) {
      final (start, weights) = taps[ox];
      var r = 0.0, g = 0.0, b = 0.0;
      for (var k = 0; k < weights.length; k++) {
        final i = (y * side + start + k) * 3;
        r += square[i] * weights[k];
        g += square[i + 1] * weights[k];
        b += square[i + 2] * weights[k];
      }
      final o = (y * size + ox) * 3;
      rows[o] = r;
      rows[o + 1] = g;
      rows[o + 2] = b;
    }
  }
  final out = Float32List(size * size * 3);
  final plane = size * size;
  for (var oy = 0; oy < size; oy++) {
    final (start, weights) = taps[oy];
    for (var ox = 0; ox < size; ox++) {
      var r = 0.0, g = 0.0, b = 0.0;
      for (var k = 0; k < weights.length; k++) {
        final i = ((start + k) * size + ox) * 3;
        r += rows[i] * weights[k];
        g += rows[i + 1] * weights[k];
        b += rows[i + 2] * weights[k];
      }
      final pixel = oy * size + ox;
      if (request.channelsFirst) {
        out[pixel] = r;
        out[plane + pixel] = g;
        out[2 * plane + pixel] = b;
      } else {
        out[pixel * 3] = r;
        out[pixel * 3 + 1] = g;
        out[pixel * 3 + 2] = b;
      }
    }
  }
  return out;
}

/// PIL's bilinear resampling weights: a triangle widened by the downscale
/// factor (antialiasing), for each output index its first input and weights.
List<(int, List<double>)> _bilinearTaps(int inSize, int outSize) {
  final scale = inSize / outSize;
  final filterScale = math.max(1.0, scale);
  return [
    for (var i = 0; i < outSize; i++)
      () {
        final center = (i + 0.5) * scale;
        // Truncation, not floor, exactly as PIL's C code.
        final first = math.max(0, (center - filterScale + 0.5).toInt());
        final last = math.min(inSize, (center + filterScale + 0.5).toInt());
        final weights = [
          for (var j = first; j < last; j++)
            math.max(0.0, 1 - ((j - center + 0.5) / filterScale).abs()),
        ];
        final total = weights.fold<double>(0, (sum, w) => sum + w);
        return (first, [for (final w in weights) w / total]);
      }(),
  ];
}

class _Sampler {
  _Sampler(this.frame);

  final FrameData frame;

  void write(int x, int y, Float32List out, int index, int stride) {
    if (frame.format == FrameFormat.bgra8888) {
      final plane = frame.planes[0];
      final pixel = y * plane.bytesPerRow + x * 4;
      out[index] = plane.bytes[pixel + 2] / 255;
      out[index + stride] = plane.bytes[pixel + 1] / 255;
      out[index + 2 * stride] = plane.bytes[pixel] / 255;
      return;
    }
    final yPlane = frame.planes[0];
    final u = frame.planes[1];
    final v = frame.planes[2];
    final luma = yPlane.bytes[y * yPlane.bytesPerRow + x];
    final uvIndex =
        (y >> 1) * u.bytesPerRow + (x >> 1) * (u.bytesPerPixel ?? 1);
    final cb = u.bytes[uvIndex] - 128;
    final cr = v.bytes[uvIndex] - 128;
    out[index] = _unit(luma + ((91881 * cr) >> 16));
    out[index + stride] = _unit(luma - ((22554 * cb + 46802 * cr) >> 16));
    out[index + 2 * stride] = _unit(luma + ((116130 * cb) >> 16));
  }

  static double _unit(int value) =>
      (value < 0 ? 0 : (value > 255 ? 255 : value)) / 255;
}
