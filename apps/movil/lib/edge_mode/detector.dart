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
  const DetectionResult(
    this.detections,
    this.letterbox,
    this.elapsed, {
    this.preprocess = Duration.zero,
    this.inference = Duration.zero,
  });

  final List<Detection> detections;
  final Letterbox letterbox;
  final Duration elapsed;
  final Duration preprocess;
  final Duration inference;
}

class _ModelJob {
  const _ModelJob(this.address, this.request, this.outputLength);

  final int address;
  final PreprocessRequest request;
  final int outputLength;
}

class _ModelOutput {
  const _ModelOutput(
    this.output,
    this.letterbox,
    this.preprocess,
    this.inference,
  );

  final Float32List output;
  final Letterbox letterbox;
  final Duration preprocess;
  final Duration inference;
}

/// Preprocess and inference in one worker isolate. Unlike tflite_flutter's
/// IsolateInterpreter, a failure here reaches the caller instead of leaving
/// the pipeline waiting forever.
_ModelOutput _runModel(_ModelJob job) {
  final watch = Stopwatch()..start();
  final input = prepareInput(job.request);
  final preprocess = watch.elapsed;
  // Allocated once in load(); the worker only borrows the native interpreter.
  final interpreter = Interpreter.fromAddress(job.address, allocated: true);
  // A ByteBuffer is the only output type tflite_flutter copies into in place.
  final output = Float32List(job.outputLength);
  interpreter.run(input.pixels.buffer, output.buffer);
  return _ModelOutput(
    output,
    input.letterbox,
    preprocess,
    watch.elapsed - preprocess,
  );
}

/// On-device YOLO, off the UI isolate so the camera preview never stutters.
class OnDeviceDetector {
  OnDeviceDetector._(this.manifest, this._interpreter);

  static const vehiclesAsset = 'assets/models/vehicles';

  final ModelManifest manifest;
  final Interpreter _interpreter;

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
    return OnDeviceDetector._(manifest, interpreter);
  }

  Future<DetectionResult> detect(
    FrameData frame, {
    double minScore = 0.35,
  }) async {
    final watch = Stopwatch()..start();
    final result = await compute(
      _runModel,
      _ModelJob(
        _interpreter.address,
        PreprocessRequest(
          frame,
          manifest.inputSize,
          channelsFirst: manifest.channelsFirst,
        ),
        manifest.outputShape.fold<int>(1, (total, value) => total * value),
      ),
    );
    final detections = decodeYolo(
      output: result.output,
      shape: manifest.outputShape,
      letterbox: result.letterbox,
      labels: manifest.labels,
      minScore: minScore,
    );
    return DetectionResult(
      detections,
      result.letterbox,
      watch.elapsed,
      preprocess: result.preprocess,
      inference: result.inference,
    );
  }

  void close() => _interpreter.close();
}
