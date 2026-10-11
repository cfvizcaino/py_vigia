import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:image/image.dart' as img;
import 'package:movil/camera_mode/camera_mode_screen.dart';
import 'package:movil/camera_mode/frame_encoder.dart';
import 'package:movil/camera_mode/mjpeg_server.dart';
import 'package:movil/edge_source.dart';

Uint8List _jpeg(int value) => img.encodeJpg(
  img.Image(width: 8, height: 8)..clear(img.ColorRgb8(value, value, value)),
);

Future<(int, Uint8List)> _get(
  String url, {
  Map<String, String>? headers,
}) async {
  final client = HttpClient();
  try {
    final request = await client.getUrl(Uri.parse(url));
    headers?.forEach(request.headers.set);
    final response = await request.close();
    final bytes = await response.fold<List<int>>(
      [],
      (all, chunk) => all..addAll(chunk),
    );
    return (response.statusCode, Uint8List.fromList(bytes));
  } finally {
    client.close(force: true);
  }
}

void main() {
  group('servidor MJPEG del modo cámara', () {
    test('sirve el último fotograma, el estado y el flujo multipart', () async {
      final server = MjpegServer();
      await server.start(address: InternetAddress.loopbackIPv4, port: 0);
      addTearDown(server.stop);
      final base = 'http://127.0.0.1:${server.port}';

      expect((await _get('$base/shot.jpg')).$1, 503);
      server.publish(_jpeg(200));
      final (status, shot) = await _get('$base/shot.jpg');
      expect(status, 200);
      expect(img.decodeJpg(shot)!.width, 8);

      // Read the stream until two frames arrive: the latest one plus a new one.
      final client = HttpClient();
      final response = await (await client.getUrl(Uri.parse('$base/video')))
          .close();
      expect(
        response.headers.contentType!.mimeType,
        'multipart/x-mixed-replace',
      );
      final received = <int>[];
      final twoFrames = Completer<void>();
      final subscription = response.listen((chunk) {
        received.addAll(chunk);
        if ('--frame'.allMatches(latin1.decode(received)).length >= 2 &&
            !twoFrames.isCompleted) {
          twoFrames.complete();
        }
      });
      await Future<void>.delayed(const Duration(milliseconds: 100));
      expect(server.clients, 1);
      server.publish(_jpeg(50));
      await twoFrames.future.timeout(const Duration(seconds: 5));
      await subscription.cancel();
      client.close(force: true);

      final statusJson = jsonDecode(
        utf8.decode((await _get('$base/status')).$2),
      );
      expect(statusJson['frames'], 2);
      expect((await _get('$base/otra')).$1, 404);
    });

    test(
      'en red local exige la clave por ?key= o por usuario y contraseña',
      () async {
        final server = MjpegServer(accessKey: 'clave-secreta');
        await server.start(address: InternetAddress.loopbackIPv4, port: 0);
        addTearDown(server.stop);
        server.publish(_jpeg(120));
        final base = 'http://127.0.0.1:${server.port}';
        expect((await _get('$base/shot.jpg')).$1, 401);
        expect((await _get('$base/shot.jpg?key=otra')).$1, 401);
        expect((await _get('$base/shot.jpg?key=clave-secreta')).$1, 200);
        final basic = base64.encode(utf8.encode('vigia:clave-secreta'));
        expect(
          (await _get(
            '$base/shot.jpg',
            headers: {'authorization': 'Basic $basic'},
          )).$1,
          200,
        );
        final wrong = base64.encode(utf8.encode('vigia:nope'));
        expect(
          (await _get(
            '$base/shot.jpg',
            headers: {'authorization': 'Basic $wrong'},
          )).$1,
          401,
        );
      },
    );

    test('las claves son aleatorias y sin caracteres ambiguos', () {
      final keys = List.generate(50, (_) => newAccessKey());
      expect(keys.toSet().length, 50);
      for (final key in keys) {
        expect(key, hasLength(12));
        expect(key, isNot(matches(RegExp('[01ilo]'))));
      }
    });
  });

  group('codificador de fotogramas', () {
    FrameData yuvFrame({
      required int y,
      required int u,
      required int v,
      int width = 64,
      int height = 32,
      int rotation = 0,
      int maxWidth = 960,
    }) {
      final yPlane = Uint8List(width * height)..fillRange(0, width * height, y);
      final chroma = (width ~/ 2) * (height ~/ 2);
      return FrameData(
        format: FrameFormat.yuv420,
        width: width,
        height: height,
        planes: [
          FramePlane(bytes: yPlane, bytesPerRow: width),
          FramePlane(
            bytes: Uint8List(chroma)..fillRange(0, chroma, u),
            bytesPerRow: width ~/ 2,
            bytesPerPixel: 1,
          ),
          FramePlane(
            bytes: Uint8List(chroma)..fillRange(0, chroma, v),
            bytesPerRow: width ~/ 2,
            bytesPerPixel: 1,
          ),
        ],
        rotationDegrees: rotation,
        maxWidth: maxWidth,
        quality: 95,
      );
    }

    test('YUV gris y rojo producen esos colores', () {
      final gray = img.decodeJpg(
        encodeFrame(yuvFrame(y: 128, u: 128, v: 128)),
      )!;
      final pixel = gray.getPixel(10, 10);
      expect(pixel.r.toInt(), closeTo(128, 6));
      expect(pixel.g.toInt(), closeTo(128, 6));
      final red = img
          .decodeJpg(encodeFrame(yuvFrame(y: 76, u: 85, v: 255)))!
          .getPixel(10, 10);
      expect(red.r.toInt(), greaterThan(200));
      expect(red.g.toInt(), lessThan(60));
    });

    test('reduce al ancho máximo y rota 90° para dejar la imagen derecha', () {
      final upright = img.decodeJpg(
        encodeFrame(
          yuvFrame(
            y: 100,
            u: 128,
            v: 128,
            width: 1280,
            height: 720,
            rotation: 90,
            maxWidth: 640,
          ),
        ),
      )!;
      expect((upright.width, upright.height), (360, 640));
      final flat = img.decodeJpg(
        encodeFrame(
          yuvFrame(
            y: 100,
            u: 128,
            v: 128,
            width: 1280,
            height: 720,
            rotation: 360,
          ),
        ),
      )!;
      expect((flat.width, flat.height), (640, 360));
    });

    test('BGRA de iOS', () {
      final bytes = Uint8List(4 * 4 * 4);
      for (var i = 0; i < bytes.length; i += 4) {
        bytes.setAll(i, [255, 0, 0, 255]); // blue in BGRA
      }
      final image = img.decodeJpg(
        encodeFrame(
          FrameData(
            format: FrameFormat.bgra8888,
            width: 4,
            height: 4,
            planes: [FramePlane(bytes: bytes, bytesPerRow: 16)],
            quality: 95,
          ),
        ),
      )!;
      expect(image.getPixel(1, 1).b.toInt(), greaterThan(200));
      expect(image.getPixel(1, 1).r.toInt(), lessThan(60));
    });
  });

  group('fuentes de video de los edges', () {
    test('validación por tipo', () {
      expect(validateSource(EdgeSource.phoneUsb, '8082'), isNull);
      expect(validateSource(EdgeSource.phoneUsb, '80'), isNotNull);
      expect(validateSource(EdgeSource.phoneLan, '192.168.1.40'), isNull);
      expect(validateSource(EdgeSource.phoneLan, '192.168.1'), isNotNull);
      expect(
        validateSource(EdgeSource.rtsp, 'rtsp://192.168.1.50:554/stream1'),
        isNull,
      );
      expect(
        validateSource(EdgeSource.rtsp, 'http://192.168.1.50/x'),
        isNotNull,
      );
      expect(
        validateSource(EdgeSource.rtsp, 'rtsp://admin:1234@cam/stream'),
        contains('Quita usuario'),
      );
      expect(
        validateSource(EdgeSource.http, 'https://cam.local/video'),
        isNull,
      );
      expect(validateSource(EdgeSource.usbCamera, '/dev/video2'), isNull);
      expect(validateSource(EdgeSource.usbCamera, '/dev/sda'), isNotNull);
    });

    test('arma el comando de instalación con la fuente y --auth cuando aplica', () {
      expect(suggestPhonePort('CEL-02'), '8082');
      expect(
        installCommand(
          cameraId: 'CEL-02',
          source: EdgeSource.phoneUsb,
          value: '8082',
          serverUrl: 'https://vigia.test',
          needsAuth: false,
        ),
        'bash infra/edges/install-node-token.sh CEL-02 8082 https://vigia.test',
      );
      expect(
        installCommand(
          cameraId: 'CEL-03',
          source: EdgeSource.phoneLan,
          value: '192.168.1.40',
          serverUrl: 'https://vigia.test',
          needsAuth: true,
        ),
        "bash infra/edges/install-node-token.sh CEL-03 'http://192.168.1.40:8080/video' https://vigia.test --auth",
      );
    });
  });
}
