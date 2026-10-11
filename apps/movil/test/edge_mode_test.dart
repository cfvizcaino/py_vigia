import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:movil/camera_mode/frame_encoder.dart';
import 'package:movil/edge_mode/detections.dart';
import 'package:movil/edge_mode/detector.dart';
import 'package:movil/edge_mode/edge_config.dart';
import 'package:movil/edge_mode/edge_engine.dart';
import 'package:movil/edge_mode/envelope.dart';
import 'package:movil/edge_mode/outbox.dart';
import 'package:movil/edge_mode/preprocess.dart';
import 'package:movil/edge_mode/tracker.dart';

/// BGRA frame where pixel (x, y) has red = x * 10 + y and green = 200.
FrameData _bgraFrame(int width, int height, {int rotation = 0}) {
  final bytes = Uint8List(width * height * 4);
  for (var y = 0; y < height; y++) {
    for (var x = 0; x < width; x++) {
      final i = (y * width + x) * 4;
      bytes[i] = 0; // B
      bytes[i + 1] = 200; // G
      bytes[i + 2] = x * 10 + y; // R
      bytes[i + 3] = 255;
    }
  }
  return FrameData(
    format: FrameFormat.bgra8888,
    width: width,
    height: height,
    planes: [
      FramePlane(bytes: bytes, bytesPerRow: width * 4, bytesPerPixel: 4),
    ],
    rotationDegrees: rotation,
  );
}

int _red(ModelInput input, int x, int y) =>
    (input.pixels[(y * input.letterbox.size + x) * 3] * 255).round();

const _letterbox = Letterbox(
  size: 320,
  scale: 0.5,
  padX: 0,
  padY: 40,
  uprightWidth: 640,
  uprightHeight: 480,
);

Detection _car(double x, double y, {double score = 0.9}) =>
    Detection(box: Box(x, y, x + 100, y + 60), score: score, label: 'car');

Future<void> _until(bool Function() condition) async {
  for (var i = 0; i < 200 && !condition(); i++) {
    await Future<void>.delayed(const Duration(milliseconds: 10));
  }
  expect(condition(), isTrue);
}

void main() {
  group('preprocesamiento', () {
    test('letterbox centra el cuadro y rellena con gris 114', () {
      final input = prepareInput(PreprocessRequest(_bgraFrame(4, 2), 8));
      expect(input.letterbox.scale, 2);
      expect(input.letterbox.padY, 2);
      expect(input.pixels[0], closeTo(114 / 255, 1e-6)); // Padding row.
      expect(_red(input, 0, 2), 0); // Pixel (0, 0).
      expect(_red(input, 7, 5), 31); // Pixel (3, 1).
      expect(input.pixels[(2 * 8) * 3 + 1], closeTo(200 / 255, 1e-6));
    });

    test('NCHW contiene los mismos valores que NHWC por canal', () {
      final frame = _bgraFrame(4, 2);
      final nhwc = prepareInput(PreprocessRequest(frame, 8));
      final nchw = prepareInput(
        PreprocessRequest(frame, 8, channelsFirst: true),
      );
      for (var pixel = 0; pixel < 64; pixel++) {
        for (var channel = 0; channel < 3; channel++) {
          expect(
            nchw.pixels[channel * 64 + pixel],
            nhwc.pixels[pixel * 3 + channel],
          );
        }
      }
    });

    test('rota 90° a la derecha antes de detectar', () {
      // Sensor 4×2 → upright 2×4; upright top-left is sensor bottom-left (0, 1).
      final input = prepareInput(
        PreprocessRequest(_bgraFrame(4, 2, rotation: 90), 4),
      );
      expect(input.letterbox.uprightWidth, 2);
      expect(input.letterbox.uprightHeight, 4);
      expect(input.letterbox.padX, 1);
      expect(_red(input, 1, 0), 1); // Sensor (0, 1).
      expect(_red(input, 2, 0), 0); // Sensor (0, 0).
      expect(_red(input, 2, 3), 30); // Sensor (3, 0).
    });

    test('convierte YUV420 a RGB', () {
      final frame = FrameData(
        format: FrameFormat.yuv420,
        width: 2,
        height: 2,
        planes: [
          FramePlane(
            bytes: Uint8List.fromList([128, 128, 128, 128]),
            bytesPerRow: 2,
          ),
          FramePlane(
            bytes: Uint8List.fromList([128]),
            bytesPerRow: 1,
            bytesPerPixel: 1,
          ),
          FramePlane(
            bytes: Uint8List.fromList([255]),
            bytesPerRow: 1,
            bytesPerPixel: 1,
          ),
        ],
      );
      final input = prepareInput(PreprocessRequest(frame, 2));
      expect(input.pixels[0], 1); // Strong Cr → red saturates.
      expect(
        input.pixels[2],
        closeTo(128 / 255, 1e-6),
      ); // Cb neutral → blue = luma.
    });
  });

  group('decodificación YOLO', () {
    test('salida end-to-end en píxeles: filtra clases y puntaje y deshace el letterbox', () {
      final output = Float32List.fromList([
        10, 50, 110, 90, 0.9, 2, // car
        0, 40, 20, 60, 0.95, 0, // person: not reported
        30, 60, 50, 80, 0.2, 3, // motorcycle below threshold
        0, 0, 0, 0, 0, 0,
      ]);
      final detections = decodeYolo(
        output: output,
        shape: const [1, 4, 6],
        letterbox: _letterbox,
      );
      expect(detections, hasLength(1));
      expect(detections.single.label, 'car');
      expect(detections.single.box.toList(), [20, 20, 220, 100]);
    });

    test('detecta coordenadas normalizadas', () {
      final output = Float32List.fromList([0.25, 0.5, 0.5, 0.75, 0.8, 3]);
      final detections = decodeYolo(
        output: output,
        shape: const [1, 1, 6],
        letterbox: _letterbox,
      );
      expect(detections.single.label, 'motorcycle');
      expect(detections.single.box.toList(), [160, 240, 320, 400]);
    });

    test('salida clásica con NMS por etiqueta', () {
      // [1, 4 + 4 classes, 3 anchors], channel-major.
      const anchors = 3;
      final output = Float32List(8 * anchors);
      void anchor(int a, List<double> box, int cls, double score) {
        for (var i = 0; i < 4; i++) {
          output[i * anchors + a] = box[i];
        }
        output[(4 + cls) * anchors + a] = score;
      }

      anchor(0, [100, 100, 40, 40], 2, 0.9);
      anchor(1, [102, 101, 40, 40], 2, 0.7); // Duplicate of anchor 0.
      anchor(2, [250, 150, 30, 30], 3, 0.6);
      final detections = decodeYolo(
        output: output,
        shape: const [1, 8, anchors],
        letterbox: _letterbox,
      );
      expect(detections.map((d) => d.label), ['car', 'motorcycle']);
      expect(detections.first.score, closeTo(0.9, 1e-6));
    });

    test('rechaza formas desconocidas', () {
      expect(
        () => decodeYolo(
          output: Float32List(4),
          shape: const [4],
          letterbox: _letterbox,
        ),
        throwsArgumentError,
      );
    });
  });

  group('tracker', () {
    test('mantiene el id de un vehículo que avanza y calcula su dirección', () {
      final tracker = IouTracker();
      final start = DateTime.utc(2026, 10, 11, 12);
      for (var step = 0; step < 6; step++) {
        tracker.update([
          _car(100 + step * 15.0, 200),
        ], start.add(Duration(milliseconds: 200 * step)));
      }
      final tracks = tracker.active(start.add(const Duration(seconds: 1)));
      expect(tracks, hasLength(1));
      expect(tracks.single.id, 1);
      expect(tracks.single.direction, 'izquierda-a-derecha');
    });

    test('un vehículo que no avanza queda con dirección indeterminada', () {
      final tracker = IouTracker();
      final now = DateTime.utc(2026);
      tracker.update([_car(10, 10)], now);
      tracker.update([
        _car(12, 11),
      ], now.add(const Duration(milliseconds: 200)));
      expect(tracker.active(now).single.direction, 'indeterminada');
    });

    test('olvida los tracks pasada la retención y no mezcla etiquetas', () {
      final tracker = IouTracker(retention: const Duration(seconds: 2));
      final now = DateTime.utc(2026);
      tracker.update([
        _car(10, 10),
        Detection(
          box: const Box(10, 10, 110, 70),
          score: 0.8,
          label: 'motorcycle',
        ),
      ], now);
      expect(tracker.active(now), hasLength(2));
      tracker.update(const [], now.add(const Duration(seconds: 3)));
      expect(tracker.active(now.add(const Duration(seconds: 3))), isEmpty);
    });
  });

  group('sobre 1.1', () {
    test('tiene las mismas claves que el nodo de visión del PC', () {
      final now = DateTime.utc(2026, 10, 11, 12, 0, 0, 123, 456);
      final track = Track(
        id: 7,
        label: 'car',
        firstSeen: now,
        firstCenter: (0, 0),
        box: const Box(1.4, 2.6, 30, 40),
        score: 0.876543,
      );
      final envelope = buildEnvelope(
        cameraId: 'CEL-02',
        sessionId: uuidV4(),
        sequenceNumber: 3,
        frameNumber: 42,
        modelName: 'yolo26n-tflite320',
        modelDigest: 'sha256:abc',
        tracks: [track],
        generatedAt: now,
      );
      expect(envelope.keys.toSet(), {
        'schemaVersion',
        'eventId',
        'sessionId',
        'sequenceNumber',
        'cameraId',
        'generatedAt',
        'nodeVersion',
        'model',
        'modelVersion',
        'modelDigest',
        'frameNumber',
        'detections',
      });
      final detection =
          (envelope['detections'] as List).single as Map<String, dynamic>;
      expect(detection.keys.toSet(), {
        'trackId',
        'vehicleType',
        'confidence',
        'firstSeen',
        'lastSeen',
        'direction',
        'boundingBox',
        'color',
        'make',
        'model',
        'licensePlate',
      });
      expect(detection['boundingBox'], [1, 3, 30, 40]);
      expect(detection['confidence'], 0.8765);
      expect(envelope['generatedAt'], '2026-10-11T12:00:00.123Z');
    });

    test('uuid v4 con formato RFC 4122', () {
      final id = uuidV4(Random(1));
      expect(
        RegExp(
          r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
        ).hasMatch(id),
        isTrue,
      );
    });
  });

  group('cola en disco', () {
    late Directory directory;

    setUp(
      () async =>
          directory = await Directory.systemTemp.createTemp('vigia-outbox'),
    );
    tearDown(() async => directory.delete(recursive: true));

    Map<String, dynamic> event(int sequence) => buildEnvelope(
      cameraId: 'CEL-02',
      sessionId: '12345678-0000-4000-8000-000000000000',
      sequenceNumber: sequence,
      frameNumber: sequence,
      modelName: 'm',
      modelDigest: null,
      tracks: const [],
    );

    test('envía en orden con el token del edge y borra lo entregado', () async {
      final sent = <int>[];
      final outbox = Outbox(
        directory: directory,
        serverUrl: 'https://central.example/',
        token: 'token-del-edge',
        client: MockClient((request) async {
          expect(
            request.url.toString(),
            'https://central.example/api/v1/ingest/detections',
          );
          expect(request.headers['X-Vigia-Device-Token'], 'token-del-edge');
          sent.add(jsonDecode(request.body)['sequenceNumber'] as int);
          return http.Response('{}', 202);
        }),
      );
      await outbox.enqueue(event(2));
      await outbox.enqueue(event(1));
      outbox.start();
      await _until(() => outbox.status.delivered == 2);
      outbox.stop();
      expect(sent, [1, 2]);
      expect(outbox.status.pending, 0);
    });

    test(
      'aparta los eventos rechazados y reintenta los errores del servidor',
      () async {
        var calls = 0;
        final outbox = Outbox(
          directory: directory,
          serverUrl: 'https://central.example',
          token: 't',
          initialBackoff: const Duration(milliseconds: 5),
          client: MockClient((request) async {
            calls++;
            final sequence = jsonDecode(request.body)['sequenceNumber'] as int;
            if (sequence == 1) return http.Response('{}', 422);
            return http.Response('{}', calls < 4 ? 503 : 202);
          }),
        );
        await outbox.enqueue(event(1));
        await outbox.enqueue(event(2));
        outbox.start();
        await _until(() => outbox.status.delivered == 1);
        outbox.stop();
        expect(outbox.status.rejected, 1);
        expect(outbox.status.retries, 2);
        expect(
          outbox.rejectedDirectory.listSync().single.path,
          endsWith('.422.json'),
        );
      },
    );

    test('no acepta más eventos con la cola llena', () async {
      final outbox = Outbox(
        directory: directory,
        serverUrl: 'x',
        token: 't',
        maxQueue: 1,
      );
      expect(await outbox.enqueue(event(1)), isTrue);
      expect(await outbox.enqueue(event(2)), isFalse);
      expect(outbox.status.lastError, 'OUTBOX_FULL');
    });
  });

  test('el motor publica un snapshot con los vehículos rastreados', () async {
    final directory = await Directory.systemTemp.createTemp('vigia-engine');
    addTearDown(() => directory.delete(recursive: true));
    final bodies = <Map<String, dynamic>>[];
    final engine = EdgeEngine(
      cameraId: 'CEL-02',
      modelName: 'yolo26n-tflite320',
      modelDigest: 'sha256:abc',
      snapshotInterval: const Duration(hours: 1),
      detect: (_) async => (
        detections: [_car(10, 20)],
        elapsed: const Duration(milliseconds: 30),
      ),
      outbox: Outbox(
        directory: directory,
        serverUrl: 'https://central.example',
        token: 't',
        client: MockClient((request) async {
          bodies.add(jsonDecode(request.body) as Map<String, dynamic>);
          return http.Response('{}', 202);
        }),
      ),
    )..start();
    await engine.process(_bgraFrame(2, 2));
    await engine.snapshot();
    await _until(() => bodies.isNotEmpty);
    await engine.stop();
    final first = bodies.first;
    expect(first['cameraId'], 'CEL-02');
    expect(first['sequenceNumber'], 1);
    expect(first['modelDigest'], 'sha256:abc');
    expect((first['detections'] as List).single['vehicleType'], 'car');
    expect(engine.stats.inferenceMs, 30);
  });

  test('un fallo o una detección colgada no bloquean el motor', () async {
    final directory = await Directory.systemTemp.createTemp('vigia-engine');
    addTearDown(() => directory.delete(recursive: true));
    var calls = 0;
    final engine = EdgeEngine(
      cameraId: 'CEL-02',
      modelName: 'm',
      modelDigest: null,
      snapshotInterval: const Duration(hours: 1),
      detectTimeout: const Duration(milliseconds: 50),
      detect: (_) async {
        calls++;
        if (calls == 1) throw StateError('modelo roto');
        if (calls == 2) await Future<void>.delayed(const Duration(seconds: 5));
        return (detections: <Detection>[], elapsed: Duration.zero);
      },
      outbox: Outbox(directory: directory, serverUrl: 'x', token: 't'),
    )..start();
    await engine.process(_bgraFrame(2, 2));
    expect(engine.stats.lastError, contains('modelo roto'));
    await engine.process(_bgraFrame(2, 2));
    expect(engine.stats.failures, 2);
    expect(engine.stats.lastError, contains('tardó'));
    expect(engine.busy, isFalse);
    await engine.process(_bgraFrame(2, 2));
    expect(engine.stats.framesProcessed, 1);
    expect(engine.stats.lastError, isNull);
    await engine.stop();
  });

  test(
    'el manifiesto del modelo empaquetado describe la entrada y la salida',
    () {
      final manifest = ModelManifest.fromJson(
        jsonDecode(File('assets/models/vehicles.json').readAsStringSync())
            as Map<String, dynamic>,
      );
      expect(manifest.inputSize, 320);
      expect(manifest.channelsFirst, isTrue);
      expect(manifest.outputShape, [1, 300, 6]);
      expect(manifest.labels, {2: 'car', 3: 'motorcycle'});
      expect(manifest.digest, startsWith('sha256:'));
      expect(
        File('assets/models/vehicles.tflite').lengthSync(),
        greaterThan(1000000),
      );
    },
  );

  group('verificación del token', () {
    const config = EdgeConfig(
      cameraId: 'CEL-02',
      serverUrl: 'https://central.example',
      token: 't',
    );

    test('acepta un 202', () async {
      expect(
        await verifyEdgeToken(
          config,
          client: MockClient((_) async => http.Response('{}', 202)),
        ),
        isNull,
      );
    });

    test('explica un token de otra cámara', () async {
      final problem = await verifyEdgeToken(
        config,
        client: MockClient((_) async => http.Response('{}', 403)),
      );
      expect(problem, contains('otra cámara'));
    });
  });
}
