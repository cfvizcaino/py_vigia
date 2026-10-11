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
