import 'dart:async';
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
    this.timeout = const Duration(seconds: 15),
  }) : baseUrl = baseUrl.replaceAll(RegExp(r'/+$'), ''),
       _httpClient = httpClient ?? http.Client();

  final String baseUrl;
  final TokenStore tokenStore;
  final http.Client _httpClient;
  final void Function()? onUnauthorized;

  /// Without a limit a wrong address or a filtering network would spin forever.
  final Duration timeout;

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

  /// Cases of the scoring dataset; empty on the pilot database or on older
  /// backends that predate the endpoint.
  Future<List<Scenario>> getScenarios() async {
    try {
      final json = await _request('GET', '/api/v1/scenarios');
      return (json['items'] as List? ?? const [])
          .map((item) => Scenario.fromJson(item as Map<String, dynamic>))
          .toList(growable: false);
    } on ApiException catch (error) {
      if (error.statusCode == 404) return const [];
      rethrow;
    }
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
        await _httpClient.send(request).timeout(timeout),
      ).timeout(timeout);
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
    } on TimeoutException {
      throw const ApiException(
        null,
        'El servidor no respondió a tiempo. Revisa la URL y la conexión.',
      );
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
    // The backend's `detail` texts are English and meant for developers.
    return switch (response.statusCode) {
      429 =>
        'Demasiados intentos. Espera 15 minutos antes de volver a intentar.',
      404 => 'No se encontró el recurso solicitado.',
      400 || 422 => 'El servidor rechazó los datos. Revisa los filtros e inténtalo de nuevo.',
      >= 500 => 'El servidor central encontró un error. Intenta nuevamente.',
      _ => 'Error del servidor (${response.statusCode}).',
    };
  }
}
