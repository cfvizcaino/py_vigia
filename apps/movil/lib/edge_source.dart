/// Where an edge node reads its video from. The app only uses this to build the
/// install command for the node's PC: camera addresses and passwords never go
/// to the central server.
enum EdgeSource { phoneUsb, phoneLan, rtsp, http, usbCamera }

extension EdgeSourceLabel on EdgeSource {
  String get label => switch (this) {
    EdgeSource.phoneUsb => 'Teléfono con VIGÍA · cable USB',
    EdgeSource.phoneLan => 'Teléfono con VIGÍA · red local',
    EdgeSource.rtsp => 'Cámara RTSP (Tapo, Hikvision…)',
    EdgeSource.http => 'Flujo HTTP / MJPEG',
    EdgeSource.usbCamera => 'Webcam USB del PC',
  };

  String get fieldLabel => switch (this) {
    EdgeSource.phoneUsb => 'Puerto local en el PC',
    EdgeSource.phoneLan => 'IP del teléfono en la red local',
    EdgeSource.rtsp => 'URL RTSP sin usuario ni contraseña',
    EdgeSource.http => 'URL del flujo',
    EdgeSource.usbCamera => 'Dispositivo de video',
  };

  String get hint => switch (this) {
    EdgeSource.phoneUsb => '8082',
    EdgeSource.phoneLan => '192.168.1.40',
    EdgeSource.rtsp => 'rtsp://192.168.1.50:554/stream1',
    EdgeSource.http => 'http://192.168.1.60:8080/video',
    EdgeSource.usbCamera => '/dev/video2',
  };

  /// Phones on the LAN are protected by their access key; RTSP cameras almost
  /// always ask for credentials.
  bool get authByDefault =>
      this == EdgeSource.phoneLan || this == EdgeSource.rtsp;
}

/// Suggested local port for a phone over USB: CEL-02 → 8082.
String suggestPhonePort(String cameraId) {
  final match = RegExp(r'(\d+)$').firstMatch(cameraId);
  final number = int.tryParse(match?.group(1) ?? '') ?? 1;
  return '${8080 + number.clamp(1, 99)}';
}

String? validateSource(EdgeSource source, String value) {
  final text = value.trim();
  switch (source) {
    case EdgeSource.phoneUsb:
      final port = int.tryParse(text);
      return port == null || port < 1024 || port > 65535
          ? 'Usa un puerto entre 1024 y 65535.'
          : null;
    case EdgeSource.phoneLan:
      final parts = text.split('.');
      final valid =
          parts.length == 4 &&
          parts.every((part) {
            final number = int.tryParse(part);
            return number != null && number >= 0 && number <= 255;
          });
      return valid ? null : 'Escribe una IPv4, p. ej. 192.168.1.40.';
    case EdgeSource.rtsp:
      return _validateUrl(text, const {'rtsp', 'rtsps'});
    case EdgeSource.http:
      return _validateUrl(text, const {'http', 'https'});
    case EdgeSource.usbCamera:
      return RegExp(r'^/dev/video\d+$').hasMatch(text)
          ? null
          : 'Usa la forma /dev/videoN.';
  }
}

String? _validateUrl(String text, Set<String> schemes) {
  final uri = Uri.tryParse(text);
  if (uri == null || !schemes.contains(uri.scheme) || uri.host.isEmpty) {
    return 'Debe empezar por ${schemes.map((s) => '$s://').join(' o ')} e incluir el host.';
  }
  if (uri.userInfo.isNotEmpty) {
    return 'Quita usuario y contraseña de la URL: el script del PC los pide sin mostrarlos.';
  }
  if (uri.hasPort && (uri.port < 1 || uri.port > 65535)) {
    return 'Puerto no válido.';
  }
  return null;
}

/// The value the node's install script expects as its source argument.
String sourceArgument(EdgeSource source, String value) {
  final text = value.trim();
  return switch (source) {
    EdgeSource.phoneLan => 'http://$text:8080/video',
    _ => text,
  };
}

String installCommand({
  required String cameraId,
  required EdgeSource source,
  required String value,
  required String serverUrl,
  required bool needsAuth,
}) {
  final argument = sourceArgument(source, value);
  final quoted = argument.contains('://') ? "'$argument'" : argument;
  return 'bash infra/edges/install-node-token.sh $cameraId $quoted $serverUrl'
      '${needsAuth ? ' --auth' : ''}';
}
