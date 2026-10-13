import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:movil/camera_mode/frame_encoder.dart';
import 'package:movil/edge_mode/colors.dart';
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

    test('el recorte de color toma el cuadrado central de la caja', () {
      // Box 4×2 at (1, 0) → centred square x 2..4, y 0..2, scaled to 4×4.
      final crop = prepareCrop(CropRequest(_bgraFrame(8, 4), (1, 0, 5, 2), 4));
      int red(int x, int y) => (crop[(y * 4 + x) * 3] * 255).round();
      expect(red(0, 0), 20); // Upright (2, 0).
      expect(red(3, 3), 31); // Upright (3, 1).
      expect(crop[1], closeTo(200 / 255, 1e-6));
    });

    test('el recorte reduce con el bilineal con antialiasing de PIL', () {
      // Reference values: PIL Image.resize(BILINEAR) on the same red channel.
      final crop = prepareCrop(CropRequest(_bgraFrame(4, 4), (0, 0, 4, 4), 2));
      final red = [for (var i = 0; i < 4; i++) crop[i * 3] * 255];
      expect(red[0], closeTo(7.8571, 1e-3));
      expect(red[1], closeTo(23.5714, 1e-3));
      expect(red[2], closeTo(9.4286, 1e-3));
      expect(red[3], closeTo(25.1429, 1e-3));
      final odd = prepareCrop(CropRequest(_bgraFrame(6, 6), (0, 0, 6, 6), 4));
      expect(odd[3] * 255, closeTo(17.7778 + 0.375, 1e-3)); // Pixel (1, 0).
    });

    test('el recorte de color respeta la rotación del sensor', () {
      final frame = _bgraFrame(4, 2, rotation: 90); // Upright 2×4.
      final crop = prepareCrop(CropRequest(frame, (0, 0, 2, 2), 2));
      final input = prepareInput(PreprocessRequest(frame, 4));
      // Upright (0, 0) is sensor (0, 1) in both paths.
      expect(crop[0], input.pixels[(0 * 4 + 1) * 3]);
      expect((crop[0] * 255).round(), 1);
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
      for (final ms in [0, 100]) {
        tracker.update([
          _car(10, 10),
          Detection(
            box: const Box(10, 10, 110, 70),
            score: 0.8,
            label: 'motorcycle',
          ),
        ], now.add(Duration(milliseconds: ms)));
      }
      expect(tracker.active(now), hasLength(2));
      tracker.update(const [], now.add(const Duration(seconds: 3)));
      expect(tracker.active(now.add(const Duration(seconds: 3))), isEmpty);
    });
  });

  group('seguimiento sin fragmentar', () {
    final start = DateTime.utc(2026, 10, 12);
    DateTime at(int ms) => start.add(Duration(milliseconds: ms));

    test('las detecciones débiles mantienen al vehículo con su id', () {
      final tracker = IouTracker();
      tracker.update([_car(100, 100)], at(0));
      tracker.update([_car(104, 100)], at(170));
      // The score dips under 0.35 for a second: the old tracker lost it here.
      for (var i = 2; i < 8; i++) {
        tracker.update([_car(100 + i * 4.0, 100, score: 0.18)], at(170 * i));
      }
      tracker.update([_car(140, 100)], at(170 * 8));
      final tracks = tracker.active(at(170 * 8));
      expect(tracks.map((t) => t.id), [1]);
      expect(tracks.single.bestScore, closeTo(0.9, 1e-9));
      expect(tracks.single.score, closeTo(0.9, 1e-9));
    });

    test('un parpadeo de un cuadro nunca se publica', () {
      final tracker = IouTracker();
      tracker.update([_car(100, 100)], at(0));
      expect(tracker.active(at(0)), isEmpty, reason: 'tentative');
      tracker.update(const [], at(170));
      tracker.update([_car(400, 100)], at(340));
      tracker.update([_car(404, 100)], at(510));
      expect(tracker.active(at(510)).map((t) => t.id), [2]);
    });

    test('una detección débil no crea vehículos', () {
      final tracker = IouTracker();
      for (var i = 0; i < 5; i++) {
        tracker.update([_car(100, 100, score: 0.2)], at(170 * i));
      }
      expect(tracker.active(at(680)), isEmpty);
    });

    test('recupera un vehículo perdido unos segundos, con su predicción', () {
      final tracker = IouTracker();
      // 50 px/s to the right, hidden 3 s behind a pole, then seen again.
      tracker.update([_car(100, 100)], at(0));
      tracker.update([_car(110, 100)], at(200));
      tracker.update([_car(120, 100)], at(400));
      for (var i = 3; i < 18; i++) {
        tracker.update(const [], at(200 * i));
      }
      tracker.update([_car(270, 100)], at(3400));
      expect(tracker.active(at(3400)).map((t) => t.id), [1]);
      expect(tracker.active(at(3400)).single.direction, 'izquierda-a-derecha');
    });
  });

  group('color', () {
    test('exige dos votos y un promedio claro', () {
      final now = DateTime.utc(2026);
      final votes = ColorVotes()..add({'red': 0.9, 'white': 0.1}, now);
      expect(votes.color, isNull);
      votes.add({'red': 0.7, 'white': 0.3}, now);
      expect(votes.color, 'red');
      final unsure = ColorVotes()
        ..add({'red': 0.45, 'white': 0.4, 'gray': 0.15}, now)
        ..add({'red': 0.4, 'white': 0.45, 'gray': 0.15}, now);
      expect(unsure.color, isNull);
    });

    test('espacia las muestras y deja de pedirlas', () {
      final start = DateTime.utc(2026);
      final votes = ColorVotes();
      expect(votes.wantsSample(start), isTrue);
      votes.add({'red': 1}, start);
      expect(
        votes.wantsSample(start.add(const Duration(milliseconds: 200))),
        isFalse,
      );
      for (var i = 1; i < ColorVotes.maxVotes; i++) {
        votes.add({'red': 1}, start.add(Duration(seconds: i)));
      }
      expect(votes.wantsSample(start.add(const Duration(hours: 1))), isFalse);
    });

    test('el motor envía el color votado y un fallo de color no tumba la detección', () async {
      final directory = await Directory.systemTemp.createTemp('vigia-engine');
      addTearDown(() => directory.delete(recursive: true));
      var tick = DateTime.utc(2026, 10, 11);
      var classifyCalls = 0;
      final sizes = <int>[];
      final engine = EdgeEngine(
        cameraId: 'CEL-02',
        modelName: 'm',
        modelDigest: null,
        snapshotInterval: const Duration(hours: 1),
        clock: () => tick = tick.add(const Duration(seconds: 1)),
        detect: (_) async => (
          detections: [
            _car(10, 20),
            Detection(
              box: const Box(300, 300, 310, 310),
              score: 0.9,
              label: 'car',
            ),
          ],
          elapsed: Duration.zero,
        ),
        classifyColors: (frame, boxes) async {
          classifyCalls++;
          sizes.add(boxes.length);
          if (classifyCalls == 2) throw StateError('clasificador roto');
          return [
            for (final _ in boxes) {'white': 0.8, 'black': 0.2},
          ];
        },
        outbox: Outbox(directory: directory, serverUrl: 'x', token: 't'),
      )..start();
      // Frame 1 only creates tentative tracks; colour sampling starts at 2.
      for (var i = 0; i < 4; i++) {
        await engine.process(_bgraFrame(2, 2));
      }
      expect(sizes, [1, 1, 1], reason: 'the 10 px box is never classified');
      expect(engine.stats.framesProcessed, 4);
      expect(engine.stats.failures, 0);
      expect(engine.stats.colorFailures, 1);
      final tracks = engine.tracker.active(tick);
      expect(tracks.map((track) => track.color), ['white', null]);
      expect(engine.latestTracks, hasLength(2));
      final envelope = buildEnvelope(
        cameraId: 'CEL-02',
        sessionId: uuidV4(),
        sequenceNumber: 1,
        frameNumber: 3,
        modelName: 'm',
        modelDigest: null,
        tracks: tracks,
      );
      expect((envelope['detections'] as List).first['color'], 'white');
      await engine.stop();
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
    // A vehicle is published from its second detection on.
    await engine.process(_bgraFrame(2, 2));
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

  test('sin vehículos el latido espera y con vehículos vuelve a los 2 s', () async {
    final directory = await Directory.systemTemp.createTemp('vigia-idle');
    addTearDown(() => directory.delete(recursive: true));
    var now = DateTime.utc(2026, 10, 12, 12);
    List<Map<String, dynamic>> queued() {
      final events = [
        for (final entity in directory.listSync())
          if (entity.path.endsWith('.json'))
            jsonDecode(File(entity.path).readAsStringSync()) as Map<String, dynamic>,
      ]..sort(
        (a, b) => (a['sequenceNumber'] as int).compareTo(b['sequenceNumber'] as int),
      );
      return events;
    }
    final engine = EdgeEngine(
      cameraId: 'CEL-02',
      modelName: 'm',
      modelDigest: null,
      snapshotInterval: const Duration(seconds: 2),
      idleSnapshotInterval: const Duration(seconds: 30),
      clock: () => now,
      detect: (_) async => (
        detections: [_car(10, 20)],
        elapsed: Duration.zero,
      ),
      outbox: Outbox(
        directory: directory,
        serverUrl: 'https://central.example',
        token: 't',
      ),
    );
    await engine.snapshot();
    now = now.add(const Duration(seconds: 2));
    await engine.snapshot();
    expect(queued(), hasLength(1));
    now = now.add(const Duration(seconds: 28));
    await engine.snapshot();
    expect(queued(), hasLength(2));
    expect(queued().last['detections'], isEmpty);

    // process() drops the frame until start(), and start() would deliver the
    // outbox (these files) and arm a real timer. The snapshot reads the
    // tracker, so the vehicle is registered here on the fake clock.
    engine.tracker.update([_car(10, 20)], now);
    engine.tracker.update([_car(10, 20)], now);
    now = now.add(const Duration(seconds: 2));
    await engine.snapshot();
    expect(queued(), hasLength(3));
    expect((queued().last['detections'] as List), isNotEmpty);
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

  test('el clasificador de color empaquetado declara sus 8 colores', () {
    final manifest = ModelManifest.fromJson(
      jsonDecode(File('assets/models/colors.json').readAsStringSync())
          as Map<String, dynamic>,
    );
    expect(manifest.task, 'classify');
    expect(manifest.inputSize, 128);
    expect(manifest.outputShape, [1, 8]);
    expect(manifest.labels.values.toSet(), {
      'black',
      'blue',
      'brown',
      'gray',
      'green',
      'red',
      'white',
      'yellow',
    });
    expect(colorNamesEs.keys.toSet(), manifest.labels.values.toSet());
  });

  test('cada modelo de assets/models está declarado en pubspec.yaml', () {
    // The tests read assets from disk; only pubspec puts them in the APK.
    final pubspec = File('pubspec.yaml').readAsStringSync();
    final models = Directory('assets/models').listSync().whereType<File>();
    expect(models, isNotEmpty);
    for (final model in models) {
      final path = model.path.replaceAll(r'\\', '/');
      expect(pubspec, contains('- $path'), reason: '$path no va en el APK');
    }
  });

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
