import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:movil/api_client.dart';
import 'package:movil/app.dart';
import 'package:movil/models.dart';
import 'package:movil/screens/cameras_screen.dart';
import 'package:movil/session.dart';

class _MemoryTokenStore implements TokenStore {
  @override
  Future<void> clear() async {}

  @override
  Future<String?> read() async => null;

  @override
  Future<void> write(String token) async {}
}

void main() {
  testWidgets('login ofrece demo claramente marcada y aviso permanente', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 844);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({});
    final preferences = await SharedPreferences.getInstance();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          preferencesProvider.overrideWithValue(preferences),
          tokenStoreProvider.overrideWithValue(_MemoryTokenStore()),
        ],
        child: const VigiaApp(),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Iniciar sesión'), findsOneWidget);
    expect(find.text('Explorar demo'), findsOneWidget);
    expect(
      find.text(
        'Trayectorias estimadas; no constituyen una identificación confirmada',
      ),
      findsOneWidget,
    );

    await tester.ensureVisible(find.text('Explorar demo'));
    await tester.tap(find.text('Explorar demo'));
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 500));

    expect(find.text('DEMOSTRACIÓN'), findsOneWidget);
    expect(find.text('Cámaras'), findsWidgets);
  });

  testWidgets('un caso del dataset llena el formulario y envía esa consulta', (
    tester,
  ) async {
    tester.view.physicalSize = const Size(390, 1600);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    const devices = [
      Device(
        id: 'd1',
        externalId: 'SC-01',
        name: 'Carrera 58',
        kind: 'simulated',
        status: 'simulated',
        lat: 11.01277,
        lng: -74.817474,
      ),
      Device(
        id: 'd7',
        externalId: 'SC-07',
        name: 'Calle 81',
        kind: 'simulated',
        status: 'simulated',
        lat: 11.008375,
        lng: -74.809824,
      ),
    ];
    const scenarios = [
      Scenario(
        id: 'S02',
        title: 'Dos vehículos iguales',
        cameraId: 'SC-07',
        radiusM: 2500,
        date: '2026-09-15',
        timeFrom: '07:20',
        timeTo: '07:40',
        vehicleType: 'car',
        color: 'silver',
      ),
    ];
    QueryInput? sent;
    await tester.pumpWidget(
      MaterialApp(
        home: Scaffold(
          body: QueryScreen(
            devices: devices,
            scenarios: scenarios,
            busy: false,
            isDemo: false,
            onSearch: (input) => sent = input,
          ),
        ),
      ),
    );
    await tester.tap(find.text('Caso del dataset de pruebas'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('S02 · Dos vehículos iguales').last);
    await tester.pumpAndSettle();

    // The dropdowns must show the applied values, not their first value.
    expect(find.text('SC-07 · Calle 81'), findsOneWidget);
    expect(find.text('Plateado'), findsOneWidget);
    expect(find.text('2026-09-15 07:20'), findsOneWidget);

    await tester.ensureVisible(find.text('Consultar trayectorias'));
    await tester.tap(find.text('Consultar trayectorias'));
    await tester.pump();

    expect(sent!.lat, 11.008375);
    expect(sent!.radiusM, 2500);
    expect(sent!.timeFrom, DateTime.utc(2026, 9, 15, 12, 20));
    expect(sent!.timeTo, DateTime.utc(2026, 9, 15, 12, 40));
    expect(sent!.vehicleType, 'car');
    expect(sent!.color, 'silver');
  });
}
