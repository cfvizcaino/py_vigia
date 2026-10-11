import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'envelope.dart';

/// Identity of this phone as an autonomous edge. The device token lives only in
/// secure storage; camera id and server are plain preferences.
class EdgeConfig {
  const EdgeConfig({
    required this.cameraId,
    required this.serverUrl,
    required this.token,
  });

  final String cameraId;
  final String serverUrl;
  final String token;
}

abstract interface class EdgeConfigStore {
  Future<EdgeConfig?> load();
  Future<void> save(EdgeConfig config);
  Future<void> clear();
}

class DeviceEdgeConfigStore implements EdgeConfigStore {
  DeviceEdgeConfigStore(this._preferences, [FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _cameraKey = 'vigia_edge_camera';
  static const _serverKey = 'vigia_edge_server';
  static const _tokenKey = 'vigia_edge_token';
  final SharedPreferences _preferences;
  final FlutterSecureStorage _storage;

  @override
  Future<EdgeConfig?> load() async {
    final camera = _preferences.getString(_cameraKey);
    final server = _preferences.getString(_serverKey);
    final token = await _storage.read(key: _tokenKey);
    if (camera == null || server == null || token == null) return null;
    return EdgeConfig(cameraId: camera, serverUrl: server, token: token);
  }

  @override
  Future<void> save(EdgeConfig config) async {
    await _storage.write(key: _tokenKey, value: config.token);
    await _preferences.setString(_cameraKey, config.cameraId);
    await _preferences.setString(_serverKey, config.serverUrl);
  }

  @override
  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _preferences.remove(_cameraKey);
    await _preferences.remove(_serverKey);
  }
}

/// Checks the token against the central with an empty envelope before saving it,
/// like infra/edges/install-node-token.sh. Returns null when it is valid.
Future<String?> verifyEdgeToken(
  EdgeConfig config, {
  http.Client? client,
}) async {
  final body = buildEnvelope(
    cameraId: config.cameraId,
    sessionId: uuidV4(),
    sequenceNumber: 0,
    frameNumber: 0,
    modelName: 'verificacion',
    modelDigest: null,
    tracks: const [],
  );
  final http.Response response;
  try {
    response = await (client ?? http.Client())
        .post(
          Uri.parse(
            '${config.serverUrl.replaceAll(RegExp(r'/+$'), '')}/api/v1/ingest/detections',
          ),
          headers: {
            'Content-Type': 'application/json',
            'X-Vigia-Device-Token': config.token,
          },
          body: jsonEncode(body),
        )
        .timeout(const Duration(seconds: 15));
  } catch (_) {
    return 'No se pudo conectar con el servidor. Revisa la URL y la conexión.';
  }
  return switch (response.statusCode) {
    202 || 200 => null,
    401 => 'El servidor rechazó el token (inválido, vencido o revocado).',
    403 => 'Ese token pertenece a otra cámara, no a ${config.cameraId}.',
    404 => '${config.cameraId} no está registrada en el servidor.',
    _ => 'El servidor respondió ${response.statusCode}.',
  };
}
