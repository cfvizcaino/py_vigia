import 'dart:convert';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

import 'api_client.dart';
import 'models.dart';

final preferencesProvider = Provider<SharedPreferences>(
  (ref) => throw StateError('SharedPreferences no fue inicializado.'),
);
final tokenStoreProvider = Provider<TokenStore>((ref) => SecureTokenStore());

final sessionProvider = NotifierProvider<SessionController, SessionState>(
  SessionController.new,
);

const defaultApiUrl = 'http://10.0.2.2:8000';
const _apiUrlKey = 'vigia_api_base_url';

class SessionState {
  const SessionState({
    this.restoring = true,
    this.busy = false,
    this.isDemo = false,
    this.user,
    this.baseUrl = defaultApiUrl,
    this.error,
    this.devices = const [],
    this.scenarios = const [],
    this.history = const [],
    this.activeResult,
  });

  final bool restoring;
  final bool busy;
  final bool isDemo;
  final AppUser? user;
  final String baseUrl;
  final String? error;
  final List<Device> devices;
  final List<Scenario> scenarios;
  final List<QueryResult> history;
  final QueryResult? activeResult;

  SessionState copyWith({
    bool? restoring,
    bool? busy,
    bool? isDemo,
    AppUser? user,
    bool clearUser = false,
    String? baseUrl,
    String? error,
    bool clearError = false,
    List<Device>? devices,
    List<Scenario>? scenarios,
    List<QueryResult>? history,
    QueryResult? activeResult,
    bool clearActiveResult = false,
  }) => SessionState(
    restoring: restoring ?? this.restoring,
    busy: busy ?? this.busy,
    isDemo: isDemo ?? this.isDemo,
    user: clearUser ? null : user ?? this.user,
    baseUrl: baseUrl ?? this.baseUrl,
    error: clearError ? null : error ?? this.error,
    devices: devices ?? this.devices,
    scenarios: scenarios ?? this.scenarios,
    history: history ?? this.history,
    activeResult: clearActiveResult ? null : activeResult ?? this.activeResult,
  );
}

class SessionController extends Notifier<SessionState> {
  late final TokenStore _tokenStore = ref.read(tokenStoreProvider);
  late final http.Client _httpClient = http.Client();

  @override
  SessionState build() {
    final preferences = ref.read(preferencesProvider);
    return SessionState(
      baseUrl: preferences.getString(_apiUrlKey) ?? defaultApiUrl,
    );
  }

  VigiaApiClient get _api => VigiaApiClient(
    baseUrl: state.baseUrl,
    tokenStore: _tokenStore,
    httpClient: _httpClient,
    onUnauthorized: _expireSession,
  );

  Future<void> restore() async {
    final token = await _tokenStore.read();
    if (token == null || token.isEmpty) {
      state = state.copyWith(restoring: false);
      return;
    }
    try {
      final user = await _api.currentUser();
      final devices = await _api.getDevices();
      state = state.copyWith(
        restoring: false,
        user: user,
        devices: devices,
        scenarios: await _optionalScenarios(),
        clearError: true,
      );
    } on ApiException catch (error) {
      state = state.copyWith(
        restoring: false,
        clearUser: error.statusCode == 401,
        error: error.statusCode == 401 ? null : error.message,
      );
    }
  }

  Future<void> login(String email, String password) async {
    state = state.copyWith(busy: true, clearError: true);
    try {
      final user = await _api.login(email, password);
      final devices = await _api.getDevices();
      state = state.copyWith(
        busy: false,
        isDemo: false,
        user: user,
        devices: devices,
        scenarios: await _optionalScenarios(),
        history: const [],
      );
    } on ApiException catch (error) {
      state = state.copyWith(busy: false, error: error.message);
    }
  }

  void exploreDemo() {
    state = state.copyWith(
      restoring: false,
      busy: false,
      isDemo: true,
      user: const AppUser(
        id: 'demo-operator',
        email: 'demostracion@vigia.local',
        displayName: 'Modo demostración',
        role: 'operator',
      ),
      devices: demoDevices,
      scenarios: const [],
      history: const [],
      clearError: true,
    );
  }

  /// The dataset picker is a convenience: its failure must never block login.
  Future<List<Scenario>> _optionalScenarios() async {
    try {
      return await _api.getScenarios();
    } on ApiException {
      return const [];
    }
  }

  Future<void> logout() async {
    if (!state.isDemo) {
      try {
        await _api.logout();
      } on ApiException {
        await _tokenStore.clear();
      }
    } else {
      await _tokenStore.clear();
    }
    state = SessionState(restoring: false, baseUrl: state.baseUrl);
  }

  Future<void> search(QueryInput input) async {
    state = state.copyWith(
      busy: true,
      clearError: true,
      clearActiveResult: true,
    );
    try {
      final result = state.isDemo
          ? runDemoQuery(input)
          : await _api.runQuery(input);
      state = state.copyWith(
        busy: false,
        activeResult: result,
        history: [result, ...state.history].take(20).toList(growable: false),
      );
    } on ApiException catch (error) {
      state = state.copyWith(busy: false, error: error.message);
    }
  }

  void openResult(QueryResult result) {
    state = state.copyWith(activeResult: result, clearError: true);
  }

  Future<String> exportJson(QueryResult result) async {
    if (state.isDemo) {
      throw const ApiException(
        null,
        'La exportación auditada solo está disponible en una sesión conectada.',
      );
    }
    final payload = await _api.exportQuery(result.query.id);
    return const JsonEncoder.withIndent('  ').convert(payload);
  }

  Future<String?> saveApiUrl(String value) async {
    final validationError = validateBackendUrl(value);
    if (validationError != null) return validationError;
    final url = value.trim().replaceAll(RegExp(r'/+$'), '');
    await ref.read(preferencesProvider).setString(_apiUrlKey, url);
    state = state.copyWith(baseUrl: url, clearError: true);
    return null;
  }

  void _expireSession() {
    state = state.copyWith(
      clearUser: true,
      isDemo: false,
      devices: const [],
      scenarios: const [],
      history: const [],
      clearActiveResult: true,
      error: 'La sesión venció. Inicia sesión nuevamente.',
    );
  }
}

String? validateBackendUrl(String value) {
  final parsed = Uri.tryParse(value.trim());
  if (parsed == null ||
      !parsed.hasAuthority ||
      parsed.host.isEmpty ||
      parsed.userInfo.isNotEmpty ||
      parsed.query.isNotEmpty ||
      parsed.fragment.isNotEmpty ||
      !{'http', 'https'}.contains(parsed.scheme)) {
    return 'Ingresa una URL válida que empiece por http:// o https://.';
  }
  const developmentHosts = {
    'localhost',
    '127.0.0.1',
    '::1',
    '10.0.2.2',
    '10.0.3.2',
  };
  if (parsed.scheme == 'http' && !developmentHosts.contains(parsed.host)) {
    return 'Las conexiones HTTP solo se permiten a localhost o al emulador. Usa HTTPS para otros hosts.';
  }
  return null;
}

const demoDevices = [
  Device(
    id: 'demo-01',
    externalId: 'CAM-01',
    name: 'Tapo C110',
    kind: 'physical',
    status: 'offline',
    lat: 11.0131,
    lng: -74.8172,
    cameraModel: 'Tapo C110',
  ),
  Device(
    id: 'demo-02',
    externalId: 'CAM-02',
    name: 'Calle 84',
    kind: 'simulated',
    status: 'simulated',
    lat: 11.011,
    lng: -74.8148,
  ),
  Device(
    id: 'demo-03',
    externalId: 'CAM-03',
    name: 'Parque Venezuela',
    kind: 'simulated',
    status: 'simulated',
    lat: 11.005,
    lng: -74.8069,
  ),
  Device(
    id: 'demo-04',
    externalId: 'CAM-04',
    name: 'Calle 72',
    kind: 'simulated',
    status: 'offline',
    lat: 11.0015,
    lng: -74.804,
  ),
];

const _demoRoutes = [
  (
    vehicle: 'car',
    color: 'white',
    cameras: [0, 1],
    times: ['14:30:00', '14:30:54'],
    score: 0.925,
  ),
  (
    vehicle: 'car',
    color: 'white',
    cameras: [2, 3],
    times: ['15:10:00', '15:11:20'],
    score: 0.78,
  ),
  (
    vehicle: 'car',
    color: 'gray',
    cameras: [0, 2, 3],
    times: ['14:35:00', '14:38:32', '14:39:52'],
    score: 0.74,
  ),
  (
    vehicle: 'motorcycle',
    color: 'black',
    cameras: [0, 1, 2, 3],
    times: ['14:42:00', '14:42:54', '14:45:35', '14:46:55'],
    score: 0.72,
  ),
];

QueryResult runDemoQuery(QueryInput input) {
  final nearby = demoDevices
      .map(
        (device) => (
          device: device,
          distance: _distanceM(input.lat, input.lng, device.lat, device.lng),
        ),
      )
      .where((entry) => entry.distance <= input.radiusM)
      .toList(growable: false);
  final routes = <CandidateRoute>[];
  var candidateCount = 0;
  for (final sample in _demoRoutes) {
    if (input.vehicleType != null && input.vehicleType != sample.vehicle) {
      continue;
    }
    if (input.color != null && input.color != sample.color) {
      continue;
    }
    final detections = <RouteDetection>[];
    for (var hop = 0; hop < sample.cameras.length; hop++) {
      final device = demoDevices[sample.cameras[hop]];
      final observedAt = DateTime.parse('2026-08-25T${sample.times[hop]}Z');
      if (!nearby.any((entry) => entry.device.id == device.id) ||
          observedAt.isBefore(input.timeFrom) ||
          observedAt.isAfter(input.timeTo)) {
        continue;
      }
      detections.add(
        RouteDetection(
          sequenceOrder: detections.length,
          detectionId: 'demo-${routes.length}-$hop',
          cameraId: device.externalId,
          vehicleType: sample.vehicle,
          color: sample.color,
          direction: 'izquierda-a-derecha',
          confidence: 0.94 - hop * 0.04,
          observedAt: observedAt,
        ),
      );
    }
    candidateCount += detections.length;
    if (detections.length < 2) continue;
    routes.add(
      CandidateRoute(
        id: 'demo-route-${routes.length + 1}',
        rank: routes.length + 1,
        confidence: sample.score,
        hasDistantGaps: routes.isNotEmpty,
        cameraIds: detections.map((item) => item.cameraId).toList(),
        vehicleType: sample.vehicle,
        color: sample.color,
        detections: detections,
        explanation: const {
          'model': 'demo-weighted-evidence',
          'calibrated_probability': false,
          'weights': {
            'detection': 0.35,
            'time': 0.4,
            'appearance': 0.15,
            'road': 0.1,
          },
          'segments': [],
        },
      ),
    );
  }
  return QueryResult(
    query: QueryRecord(
      id: 'demo-${DateTime.now().millisecondsSinceEpoch}',
      input: input,
      createdAt: DateTime.now().toUtc(),
    ),
    nearbyDevices: nearby
        .map(
          (entry) => NearbyDevice(
            id: entry.device.id,
            externalId: entry.device.externalId,
            name: entry.device.name,
            lat: entry.device.lat,
            lng: entry.device.lng,
            distanceM: entry.distance,
          ),
        )
        .toList(growable: false),
    candidateDetectionCount: candidateCount,
    routes: routes,
  );
}

double _distanceM(double lat1, double lng1, double lat2, double lng2) {
  const radius = 6371000.0;
  final latitudeDelta = _radians(lat2 - lat1);
  final longitudeDelta = _radians(lng2 - lng1);
  final a =
      math.pow(math.sin(latitudeDelta / 2), 2) +
      math.cos(_radians(lat1)) *
          math.cos(_radians(lat2)) *
          math.pow(math.sin(longitudeDelta / 2), 2);
  return radius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

double _radians(double degrees) => degrees * math.pi / 180;
