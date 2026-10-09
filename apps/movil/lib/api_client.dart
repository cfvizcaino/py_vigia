import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;

import 'models.dart';

abstract interface class TokenStore {
  Future<String?> read();
  Future<void> write(String token);
  Future<void> clear();
}

class SecureTokenStore implements TokenStore {
  SecureTokenStore([FlutterSecureStorage? storage])
    : _storage = storage ?? const FlutterSecureStorage();

  static const _tokenKey = 'vigia_session_token';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _tokenKey);

  @override
  Future<void> write(String token) =>
      _storage.write(key: _tokenKey, value: token);

  @override
  Future<void> clear() => _storage.delete(key: _tokenKey);
}

class ApiException implements Exception {
  const ApiException(this.statusCode, this.message);

  final int? statusCode;
  final String message;

  @override
  String toString() => message;
}

class VigiaApiClient {
  VigiaApiClient({
    required String baseUrl,
    required this.tokenStore,
    http.Client? httpClient,
    this.onUnauthorized,
  }) : baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
       _httpClient = httpClient ?? http.Client();

  final String baseUrl;
  final TokenStore tokenStore;
  final http.Client _httpClient;
  final void Function()? onUnauthorized;

  Future<AppUser> login(String email, String password) async {
    final json = await _request(
      'POST',
      '/api/v1/auth/login',
      body: {'email': email.trim(), 'password': password},
      authenticated: false,
    );
    await tokenStore.write(json['token'] as String);
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<AppUser> currentUser() async {
    final json = await _request('GET', '/api/v1/auth/me');
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }

  Future<void> logout() async {
    try {
      await _request('POST', '/api/v1/auth/logout');
    } finally {
      await tokenStore.clear();
    }
  }

  Future<List<Device>> getDevices() async {
    final json = await _request('GET', '/api/v1/devices');
    return (json['items'] as List? ?? json as List)
        .map((item) => Device.fromJson(item as Map<String, dynamic>))
        .toList(growable: false);
  }

  Future<QueryResult> runQuery(QueryInput input) async {
    final json = await _request(
      'GET',
      '/api/v1/queries',
      queryParameters: input.toQueryParameters(),
    );
    return QueryResult.fromJson(json);
  }

  Future<Map<String, dynamic>> exportQuery(String queryId) =>
      _request('POST', '/api/v1/queries/$queryId/export');

  Future<Map<String, dynamic>> _request(
    String method,
    String path, {
    Map<String, String>? queryParameters,
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final uri = Uri.parse('$baseUrl$path')
        .replace(queryParameters: queryParameters);
    final headers = <String, String>{'Accept': 'application/json'};
    if (body != null) headers['Content-Type'] = 'application/json';
    if (authenticated) {
      final token = await tokenStore.read();
      if (token == null || token.isEmpty) {
        throw const ApiException(401, 'Inicia sesión para continuar.');
      }
      headers['Authorization'] = 'Bearer $token';
    }

    final request = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) request.body = jsonEncode(body);
    try {
      final response = await http.Response.fromStream(
        await _httpClient.send(request),
      );
      if (response.statusCode == 401 && authenticated) {
        await tokenStore.clear();
        onUnauthorized?.call();
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw ApiException(
          response.statusCode,
          _errorMessage(response, loginRequest: !authenticated),
        );
      }
      if (response.bodyBytes.isEmpty) return const {};
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is List) return {'items': decoded};
      return Map<String, dynamic>.from(decoded as Map);
    } on ApiException {
      rethrow;
    } on http.ClientException {
      throw const ApiException(
        null,
        'No fue posible conectar con el servidor. Revisa la URL y la conexión.',
      );
    }
  }

  String _errorMessage(http.Response response, {required bool loginRequest}) {
    if (response.statusCode == 403) {
      return 'Tu rol no permite realizar esta acción.';
    }
    if (response.statusCode == 401) {
      return loginRequest
          ? 'Correo o contraseña incorrectos.'
          : 'La sesión venció. Inicia sesión nuevamente.';
    }
    if (response.statusCode == 429) {
      return 'Demasiados intentos. Espera 15 minutos antes de volver a intentar.';
    }
    try {
      final body = jsonDecode(response.body) as Map<String, dynamic>;
      final detail = body['detail'];
      if (detail is String && detail.isNotEmpty) return detail;
    } catch (_) {
      return 'No fue posible interpretar la respuesta del servidor.';
    }
    return 'Error del servidor (${response.statusCode}).';
  }
}
