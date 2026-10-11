import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';

/// Serves JPEG frames as an MJPEG stream, compatible with the vision node
/// (`VIDEO_SOURCE_URL=http://…/video`) and with the IP Webcam layout.
///
/// - `GET /video`    multipart/x-mixed-replace stream
/// - `GET /shot.jpg` latest frame
/// - `GET /status`   JSON with fps, clients and frames
///
/// Bound to loopback (USB mode, reached through `adb forward`) it needs no key.
/// On the local network every request must carry the access key, either as
/// `?key=` or as HTTP Basic password (FFmpeg/OpenCV understand `http://u:key@host`).
class MjpegServer {
  MjpegServer({this.accessKey});

  final String? accessKey;
  HttpServer? _server;
  final _frames = StreamController<Uint8List>.broadcast();
  Uint8List? _latest;
  int _clients = 0;
  int _framesPublished = 0;
  final _recentFrames = <DateTime>[];

  bool get running => _server != null;
  int get port => _server?.port ?? 0;
  int get clients => _clients;
  int get framesPublished => _framesPublished;

  double get fps {
    final cutoff = DateTime.now().subtract(const Duration(seconds: 3));
    _recentFrames.removeWhere((at) => at.isBefore(cutoff));
    return _recentFrames.length / 3;
  }

  Future<void> start({
    required InternetAddress address,
    int port = 8080,
  }) async {
    if (running) return;
    final server = await HttpServer.bind(address, port, shared: true);
    _server = server;
    server.listen(_handle, onError: (_) {});
  }

  Future<void> stop() async {
    final server = _server;
    _server = null;
    await server?.close(force: true);
    _clients = 0;
  }

  /// Called by the camera pipeline for every encoded frame.
  void publish(Uint8List jpeg) {
    _latest = jpeg;
    _framesPublished++;
    _recentFrames.add(DateTime.now());
    if (_frames.hasListener) _frames.add(jpeg);
  }

  bool _authorized(HttpRequest request) {
    final key = accessKey;
    if (key == null || key.isEmpty) return true;
    if (request.uri.queryParameters['key'] == key) return true;
    final header = request.headers.value(HttpHeaders.authorizationHeader);
    if (header != null && header.startsWith('Basic ')) {
      try {
        final decoded = utf8.decode(base64.decode(header.substring(6)));
        final separator = decoded.indexOf(':');
        if (separator >= 0 && decoded.substring(separator + 1) == key) {
          return true;
        }
      } on FormatException {
        return false;
      }
    }
    return false;
  }

  Future<void> _handle(HttpRequest request) async {
    final response = request.response;
    response.headers.set(HttpHeaders.cacheControlHeader, 'no-store');
    if (request.method != 'GET') {
      response.statusCode = HttpStatus.methodNotAllowed;
      await response.close();
      return;
    }
    if (!_authorized(request)) {
      response.statusCode = HttpStatus.unauthorized;
      response.headers.set(
        HttpHeaders.wwwAuthenticateHeader,
        'Basic realm="VIGIA camara"',
      );
      await response.close();
      return;
    }
    switch (request.uri.path) {
      case '/video':
        await _stream(response);
      case '/shot.jpg':
        final latest = _latest;
        if (latest == null) {
          response.statusCode = HttpStatus.serviceUnavailable;
        } else {
          response.headers.contentType = ContentType('image', 'jpeg');
          response.add(latest);
        }
        await response.close();
      case '/status':
        response.headers.contentType = ContentType.json;
        response.write(
          jsonEncode({
            'service': 'vigia-camera',
            'fps': double.parse(fps.toStringAsFixed(1)),
            'clients': _clients,
            'frames': _framesPublished,
          }),
        );
        await response.close();
      default:
        response.statusCode = HttpStatus.notFound;
        await response.close();
    }
  }

  Future<void> _stream(HttpResponse response) async {
    response.bufferOutput = false;
    response.headers.set(
      HttpHeaders.contentTypeHeader,
      'multipart/x-mixed-replace; boundary=frame',
    );
    _clients++;
    final done = Completer<void>();
    late final StreamSubscription<Uint8List> subscription;
    var writing = false;
    Future<void> send(Uint8List jpeg) async {
      if (writing) {
        return; // A slow client skips frames instead of queuing them.
      }
      writing = true;
      try {
        response.add(
          utf8.encode(
            '--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n',
          ),
        );
        response.add(jpeg);
        response.add(const [13, 10]);
        await response.flush();
      } catch (_) {
        if (!done.isCompleted) done.complete();
      } finally {
        writing = false;
      }
    }

    subscription = _frames.stream.listen(send);
    final latest = _latest;
    if (latest != null) unawaited(send(latest));
    unawaited(
      response.done.then((_) {}, onError: (_) {}).whenComplete(() {
        if (!done.isCompleted) done.complete();
      }),
    );
    await done.future;
    await subscription.cancel();
    _clients--;
    try {
      await response.close();
    } catch (_) {}
  }
}

/// IPv4 addresses of this phone on the local network (for LAN mode).
Future<List<String>> localNetworkAddresses() async {
  final interfaces = await NetworkInterface.list(
    type: InternetAddressType.IPv4,
  );
  return [
    for (final interface in interfaces)
      for (final address in interface.addresses)
        if (!address.isLoopback) address.address,
  ];
}
