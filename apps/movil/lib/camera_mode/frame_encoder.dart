import 'dart:typed_data';

import 'package:image/image.dart' as img;

/// Camera-independent copy of a frame, so encoding can run in an isolate and be
/// unit-tested without a device.
class FramePlane {
  const FramePlane({
    required this.bytes,
    required this.bytesPerRow,
    this.bytesPerPixel,
  });

  final Uint8List bytes;
  final int bytesPerRow;
  final int? bytesPerPixel;
}

enum FrameFormat { yuv420, bgra8888 }

class FrameData {
  const FrameData({
    required this.format,
    required this.width,
    required this.height,
    required this.planes,
    this.rotationDegrees = 0,
    this.maxWidth = 960,
    this.quality = 70,
  });

  final FrameFormat format;
  final int width;
  final int height;
  final List<FramePlane> planes;

  /// Clockwise rotation that makes the image upright (sensor + mounting).
  final int rotationDegrees;

  /// Output width limit before rotation; the frame is subsampled to fit.
  final int maxWidth;
  final int quality;
}

/// Converts one camera frame into a JPEG. Top-level so `compute` can run it.
Uint8List encodeFrame(FrameData frame) {
  // Integer subsampling while converting is much cheaper than resizing later.
  final step = (frame.width / frame.maxWidth).ceil().clamp(1, 8);
  final outWidth = frame.width ~/ step;
  final outHeight = frame.height ~/ step;
  final rgb = Uint8List(outWidth * outHeight * 3);
  switch (frame.format) {
    case FrameFormat.yuv420:
      _yuv420ToRgb(frame, step, outWidth, outHeight, rgb);
    case FrameFormat.bgra8888:
      _bgraToRgb(frame, step, outWidth, outHeight, rgb);
  }
  var image = img.Image.fromBytes(
    width: outWidth,
    height: outHeight,
    bytes: rgb.buffer,
    numChannels: 3,
  );
  final rotation = ((frame.rotationDegrees % 360) + 360) % 360;
  if (rotation != 0) image = img.copyRotate(image, angle: rotation);
  return img.encodeJpg(image, quality: frame.quality);
}

void _yuv420ToRgb(
  FrameData frame,
  int step,
  int width,
  int height,
  Uint8List out,
) {
  final y = frame.planes[0];
  final u = frame.planes[1];
  final v = frame.planes[2];
  final uvPixelStride = u.bytesPerPixel ?? 1;
  var index = 0;
  for (var row = 0; row < height; row++) {
    final sourceRow = row * step;
    final yRow = sourceRow * y.bytesPerRow;
    final uvRow = (sourceRow >> 1) * u.bytesPerRow;
    for (var column = 0; column < width; column++) {
      final sourceColumn = column * step;
      final luma = y.bytes[yRow + sourceColumn];
      final uvIndex = uvRow + (sourceColumn >> 1) * uvPixelStride;
      final cb = u.bytes[uvIndex] - 128;
      final cr = v.bytes[uvIndex] - 128;
      // BT.601 full-range integer approximation.
      out[index++] = _clamp(luma + ((91881 * cr) >> 16));
      out[index++] = _clamp(luma - ((22554 * cb + 46802 * cr) >> 16));
      out[index++] = _clamp(luma + ((116130 * cb) >> 16));
    }
  }
}

void _bgraToRgb(
  FrameData frame,
  int step,
  int width,
  int height,
  Uint8List out,
) {
  final plane = frame.planes[0];
  var index = 0;
  for (var row = 0; row < height; row++) {
    final rowStart = row * step * plane.bytesPerRow;
    for (var column = 0; column < width; column++) {
      final pixel = rowStart + column * step * 4;
      out[index++] = plane.bytes[pixel + 2];
      out[index++] = plane.bytes[pixel + 1];
      out[index++] = plane.bytes[pixel];
    }
  }
}

int _clamp(int value) => value < 0 ? 0 : (value > 255 ? 255 : value);
