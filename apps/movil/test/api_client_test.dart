import 'dart:async';
import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:movil/api_client.dart';
import 'package:movil/models.dart';
import 'package:movil/session.dart';

class MemoryTokenStore implements TokenStore {
  String? token;

  @override
  Future<String?> read() async => token;

  @override
  Future<void> write(String value) async => token = value;

  @override
  Future<void> clear() async => token = null;
}

void main() {
  const user = {
    'id': 'user-1',
    'email': 'operador@vigia.test',
    'display_name': 'Operador',
    'role': 'operator',
  };
  final store = MemoryTokenStore();

  test(
    'login almacena token y parsea el usuario sin exponer el secreto',
    () async {
      final client = VigiaApiClient(
        baseUrl: 'https://vigia.test',
        tokenStore: store,
        httpClient: MockClient((request) async {
          expect(request.url.path, '/api/v1/auth/login');
          expect(request.headers.containsKey('Authorization'), isFalse);
          expect(jsonDecode(request.body), {
            'email': 'operador@vigia.test',
            'password': 'secret',
          });
          return http.Response(
            jsonEncode({'token': 'private-token', 'user': user}),
            200,
            headers: {'content-type': 'application/json'},
          );
        }),
      );

      final result = await client.login(' operador@vigia.test ', 'secret');

      expect(result.displayName, 'Operador');
      expect(store.token, 'private-token');
    },
  );

  test(
    'consulta manda Bearer y parsea rutas, explicación y geometría',
    () async {
      store.token = 'private-token';
      final client = VigiaApiClient(
        baseUrl: 'https://vigia.test',
        tokenStore: store,
        httpClient: MockClient((request) async {
          expect(request.headers['Authorization'], 'Bearer private-token');
          expect(
            request.url.queryParameters['time_from'],
            '2026-08-25T14:20:00.000Z',
          );
          return http.Response(
            jsonEncode({
              'query': {
                'id': 'query-1',
                'lat': 11.01,
                'lng': -74.81,
                'radius_m': 2000,
                'time_from': '2026-08-25T14:20:00Z',
                'time_to': '2026-08-25T15:30:00Z',
                'vehicle_type': 'car',
                'color': 'white',
                'created_at': '2026-08-25T15:40:00Z',
              },
              'nearby_devices': [
                {
                  'id': 'device-1',
                  'external_id': 'CAM-01',
                  'name': 'Calle 84',
                  'lat': 11.0131,
                  'lng': -74.8172,
                  'distance_m': 123.4,
                },
              ],
              'candidate_detection_count': 2,
              'routes': [
                {
                  'id': 'route-1',
                  'rank': 1,
                  'confidence': 0.82,
                  'has_distant_gaps': false,
                  'camera_ids': ['CAM-01', 'CAM-02'],
                  'vehicle_type': 'car',
                  'color': 'white',
                  'detections': [
                    {
                      'sequence_order': 0,
                      'detection_id': 'd-1',
                      'camera_id': 'CAM-01',
                      'vehicle_type': 'car',
                      'color': 'white',
                      'direction': 'indeterminada',
                      'confidence': 0.9,
                      'observed_at': '2026-08-25T14:30:00Z',
                    },
                  ],
                  'explanation': {
                    'calibrated_probability': false,
                    'weights': {'time': 0.4},
                  },
                  'road_geometry': {
                    'points': [
                      {'lat': 11.0, 'lng': -74.8},
                      {'lat': 11.1, 'lng': -74.9},
                    ],
                    'source': 'road-network',
                    'distance_m': 500,
                  },
                },
              ],
            }),
            200,
          );
        }),
      );

      final result = await client.runQuery(
        QueryInput(
          lat: 11.01,
          lng: -74.81,
          radiusM: 2000,
          timeFrom: DateTime.parse('2026-08-25T14:20:00Z'),
          timeTo: DateTime.parse('2026-08-25T15:30:00Z'),
          vehicleType: 'car',
          color: 'white',
        ),
      );

      expect(result.candidateDetectionCount, 2);
      expect(result.nearbyDevices.single.externalId, 'CAM-01');
      expect(result.nearbyDevices.single.distanceM, 123.4);
      expect(result.routes.single.roadPoints, hasLength(2));
      expect(result.routes.single.explanation['calibrated_probability'], false);
    },
  );

  test('401 borra la sesión y avisa al controlador', () async {
    store.token = 'expired-token';
    var notified = false;
    final client = VigiaApiClient(
      baseUrl: 'https://vigia.test',
      tokenStore: store,
      onUnauthorized: () => notified = true,
      httpClient: MockClient((_) async => http.Response('{}', 401)),
    );

    await expectLater(client.currentUser(), throwsA(isA<ApiException>()));

    expect(store.token, isNull);
    expect(notified, isTrue);
  });

  test('modelo de cámara convierte los campos del backend', () {
    final device = Device.fromJson({
      'id': 'device-1',
      'external_id': 'CAM-01',
      'name': 'Calle 84',
      'kind': 'simulated',
      'status': 'simulated',
      'lat': 11.0131,
      'lng': -74.8172,
      'camera_model': null,
    });

    expect(device.externalId, 'CAM-01');
    expect(device.lat, 11.0131);
  });

  test('la URL solo permite HTTP en hosts de desarrollo', () {
    expect(validateBackendUrl('http://10.0.2.2:8000'), isNull);
    expect(validateBackendUrl('https://api.vigia.example'), isNull);
    expect(validateBackendUrl('http://192.168.1.12:8000'), isNotNull);
    expect(validateBackendUrl('ftp://localhost:8000'), isNotNull);
    expect(validateBackendUrl('http://user@localhost:8000'), isNotNull);
  });

  test('exportar solicita el JSON auditado al endpoint del servidor', () async {
    store.token = 'private-token';
    http.Request? capturedRequest;
    final client = VigiaApiClient(
      baseUrl: 'https://vigia.test',
      tokenStore: store,
      httpClient: MockClient((request) async {
        capturedRequest = request;
        return http.Response(
          jsonEncode({'notice': 'exportación auditada', 'routes': []}),
          200,
          headers: {'content-type': 'application/json; charset=utf-8'},
        );
      }),
    );

    final exported = await client.exportQuery('query-1');

    expect(exported['notice'], 'exportación auditada');
    expect(capturedRequest?.method, 'POST');
    expect(capturedRequest?.url.path, '/api/v1/queries/query-1/export');
    expect(capturedRequest?.headers['Authorization'], 'Bearer private-token');
  });

  test('el demo usa la misma consulta de ejemplo sin datos de red', () {
    final result = runDemoQuery(
      QueryInput(
        lat: 11.0131,
        lng: -74.8172,
        radiusM: 2000,
        timeFrom: DateTime.parse('2026-08-25T14:20:00Z'),
        timeTo: DateTime.parse('2026-08-25T15:30:00Z'),
        vehicleType: 'car',
        color: 'white',
      ),
    );

    expect(result.routes, hasLength(2));
    expect(result.routes.first.cameraIds, ['CAM-01', 'CAM-02']);
    expect(result.routes.first.roadPoints, isEmpty);
  });

  test('un servidor que no responde termina con un error claro', () async {
    store.token = 'private-token';
    final client = VigiaApiClient(
      baseUrl: 'https://vigia.test',
      tokenStore: store,
      timeout: const Duration(milliseconds: 50),
      httpClient: MockClient((_) => Completer<http.Response>().future),
    );
    expect(
      client.getDevices(),
      throwsA(
        isA<ApiException>().having(
          (error) => error.message,
          'message',
          contains('no respondió a tiempo'),
        ),
      ),
    );
  });

  test('errores del backend se explican en español', () async {
    store.token = 'private-token';
    for (final (status, expected) in [
      (422, 'Revisa los filtros'),
      (404, 'No se encontró'),
      (503, 'encontró un error'),
    ]) {
      final client = VigiaApiClient(
        baseUrl: 'https://vigia.test',
        tokenStore: store,
        httpClient: MockClient(
          (_) async => http.Response('{"detail":"Query not found"}', status),
        ),
      );
      await expectLater(
        client.getDevices(),
        throwsA(
          isA<ApiException>().having(
            (error) => error.message,
            'message',
            allOf(contains(expected), isNot(contains('not found'))),
          ),
        ),
      );
    }
  });

  test('fechas sin zona horaria se leen como UTC, no como hora local', () {
    final legacy = parseApiDate('2026-08-25T14:30:00');
    final aware = parseApiDate('2026-08-25T09:30:00-05:00');
    expect(legacy.isUtc, isTrue);
    expect(legacy, DateTime.utc(2026, 8, 25, 14, 30));
    expect(aware, legacy);
  });

  test(
    'casos del dataset: horas de Colombia a UTC y lista vacía sin endpoint',
    () async {
      store.token = 'private-token';
      final withCases = VigiaApiClient(
        baseUrl: 'https://vigia.test',
        tokenStore: store,
        httpClient: MockClient((request) async {
          expect(request.url.path, '/api/v1/scenarios');
          return http.Response(
            jsonEncode([
              {
                'id': 'S01',
                'title': 'Recorrido limpio',
                'challenge': 'control',
                'camera_id': 'SC-07',
                'radius_m': 2500.0,
                'date': '2026-09-15',
                'time_from': '07:00',
                'time_to': '07:20',
                'vehicle_type': 'car',
                'color': 'white',
              },
            ]),
            200,
          );
        }),
      );
      final cases = await withCases.getScenarios();
      expect(cases.single.radiusM, 2500);
      expect(cases.single.from, DateTime.utc(2026, 9, 15, 12));
      expect(cases.single.to, DateTime.utc(2026, 9, 15, 12, 20));

      final olderBackend = VigiaApiClient(
        baseUrl: 'https://vigia.test',
        tokenStore: store,
        httpClient: MockClient((_) async => http.Response('{}', 404)),
      );
      expect(await olderBackend.getScenarios(), isEmpty);
    },
  );
}
