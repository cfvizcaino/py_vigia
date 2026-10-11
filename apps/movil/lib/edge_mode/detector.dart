import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:tflite_flutter/tflite_flutter.dart';

import '../camera_mode/frame_encoder.dart';
import 'detections.dart';
import 'preprocess.dart';

/// What apps/vision/training/export_mobile.py writes next to each model, so the
/// app decodes any YOLO export (vehicles today, plates later) without guessing.
class ModelManifest {
  const ModelManifest({
    required this.name,
    required this.sha256,
    required this.inputSize,
    required this.channelsFirst,
    required this.outputShape,
    required this.labels,
  });

  factory ModelManifest.fromJson(Map<String, dynamic> json) {
    final input = json['input'] as Map<String, dynamic>;
    final shape = (input['shape'] as List).cast<int>();
    final channelsFirst = input['layout'] == 'NCHW';
    final labels = (json['labels'] as Map<String, dynamic>).map(
      (key, value) => MapEntry(int.parse(key), value as String),
    );
    if (shape.length != 4 || labels.isEmpty) {
      throw const FormatException('Manifiesto de modelo inválido');
    }
    return ModelManifest(
      name: (json['source'] as String).replaceAll(RegExp(r'\.pt$'), ''),
      sha256: json['sha256'] as String,
      inputSize: channelsFirst ? shape[2] : shape[1],
      channelsFirst: channelsFirst,
      outputShape: ((json['output'] as Map<String, dynamic>)['shape'] as List)
          .cast<int>(),
      labels: labels,
    );
  }

  final String name;
  final String sha256;
  final int inputSize;
  final bool channelsFirst;
  final List<int> outputShape;
  final Map<int, String> labels;

  /// Same form as the PC node's MODEL_DIGEST, so the backend can tell models apart.
  String get digest => 'sha256:$sha256';
}

class DetectionResult {
  const DetectionResult(this.detections, this.letterbox, this.elapsed);

  final List<Detection> detections;
  final Letterbox letterbox;
  final Duration elapsed;
}

/// On-device YOLO: preprocessing in a worker isolate, inference in the
/// interpreter's own isolate, so the camera preview never stutters.
class OnDeviceDetector {
  OnDeviceDetector._(this.manifest, this._interpreter, this._isolate);

  static const vehiclesAsset = 'assets/models/vehicles';

  final ModelManifest manifest;
  final Interpreter _interpreter;
  final IsolateInterpreter _isolate;

  static Future<OnDeviceDetector> load({
    String asset = vehiclesAsset,
    int threads = 4,
  }) async {
    final manifest = ModelManifest.fromJson(
      jsonDecode(await rootBundle.loadString('$asset.json'))
          as Map<String, dynamic>,
    );
    final interpreter = await Interpreter.fromAsset(
      '$asset.tflite',
      options: InterpreterOptions()..threads = threads,
    );
    final isolate = await IsolateInterpreter.create(
      address: interpreter.address,
    );
    return OnDeviceDetector._(manifest, interpreter, isolate);
  }

  Future<DetectionResult> detect(
    FrameData frame, {
    double minScore = 0.35,
  }) async {
    final watch = Stopwatch()..start();
    final input = await compute(
      prepareInput,
      PreprocessRequest(
        frame,
        manifest.inputSize,
        channelsFirst: manifest.channelsFirst,
      ),
    );
    final count = manifest.outputShape.fold<int>(
      1,
      (total, value) => total * value,
    );
    // A ByteBuffer is the only output type tflite_flutter copies into in place.
    final output = Float32List(count);
    await _isolate.run(input.pixels.buffer, output.buffer);
    final detections = decodeYolo(
      output: output,
      shape: manifest.outputShape,
      letterbox: input.letterbox,
      labels: manifest.labels,
      minScore: minScore,
    );
    return DetectionResult(detections, input.letterbox, watch.elapsed);
  }

  Future<void> close() async {
    await _isolate.close();
    _interpreter.close();
  }
}
