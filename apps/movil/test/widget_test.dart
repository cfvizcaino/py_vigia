import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'package:movil/api_client.dart';
import 'package:movil/app.dart';
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
}
