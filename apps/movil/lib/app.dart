import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'screens/cameras_screen.dart';
import 'screens/history_screen.dart';
import 'screens/login_screen.dart';
import 'screens/results_screen.dart';
import 'screens/settings_screen.dart';
import 'session.dart';
import 'widgets/shared_widgets.dart';

class VigiaApp extends StatelessWidget {
  const VigiaApp({super.key});

  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'VIGÍA · Consola móvil',
    debugShowCheckedModeBanner: false,
    theme: ThemeData(
      useMaterial3: true,
      brightness: Brightness.dark,
      colorScheme: ColorScheme.fromSeed(
        seedColor: const Color(0xFF38B899),
        brightness: Brightness.dark,
        surface: const Color(0xFF171D1A),
      ),
      scaffoldBackgroundColor: const Color(0xFF101512),
      appBarTheme: const AppBarTheme(
        backgroundColor: Color(0xFF101512),
        surfaceTintColor: Colors.transparent,
        titleTextStyle: TextStyle(
          color: Color(0xFFF0F4EF),
          fontSize: 19,
          fontWeight: FontWeight.w700,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: const Color(0xFF1C2420),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: const BorderSide(color: Color(0xFF38433D)),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6),
          borderSide: const BorderSide(color: Color(0xFF38433D)),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 14,
          vertical: 14,
        ),
      ),
      navigationBarTheme: const NavigationBarThemeData(
        height: 72,
        backgroundColor: Color(0xFF171D1A),
        indicatorColor: Color(0xFF294A40),
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 11, fontWeight: FontWeight.w600),
        ),
      ),
      snackBarTheme: const SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
      ),
    ),
    home: const ApplicationRoot(),
  );
}

class ApplicationRoot extends ConsumerStatefulWidget {
  const ApplicationRoot({super.key});

  @override
  ConsumerState<ApplicationRoot> createState() => _ApplicationRootState();
}

class _ApplicationRootState extends ConsumerState<ApplicationRoot> {
  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(sessionProvider.notifier).restore());
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);
    if (state.restoring) {
      return const Scaffold(
        body: Column(
          children: [
            Expanded(child: Center(child: CircularProgressIndicator())),
            SafetyBanner(),
          ],
        ),
      );
    }
    if (state.user == null) return const LoginScreen();
    return const OperatorShell();
  }
}

class OperatorShell extends ConsumerStatefulWidget {
  const OperatorShell({super.key});

  @override
  ConsumerState<OperatorShell> createState() => _OperatorShellState();
}

class _OperatorShellState extends ConsumerState<OperatorShell> {
  int _selectedIndex = 0;

  static const _titles = [
    'Cámaras',
    'Nueva consulta',
    'Resultados',
    'Historial',
    'Ajustes',
  ];

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);
    final controller = ref.read(sessionProvider.notifier);
    return Scaffold(
      appBar: AppBar(
        title: Text(_titles[_selectedIndex]),
        actions: [
          if (state.isDemo)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 12),
              child: _DemoBadge(),
            ),
          IconButton(
            tooltip: 'Cerrar sesión',
            onPressed: controller.logout,
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: IndexedStack(
              index: _selectedIndex,
              children: [
                CamerasScreen(devices: state.devices),
                QueryScreen(
                  devices: state.devices,
                  busy: state.busy,
                  isDemo: state.isDemo,
                  error: state.error,
                  onSearch: (input) async {
                    await controller.search(input);
                    if (ref.read(sessionProvider).activeResult != null &&
                        mounted) {
                      setState(() => _selectedIndex = 2);
                    }
                  },
                ),
                ResultsScreen(result: state.activeResult, isDemo: state.isDemo),
                HistoryScreen(
                  history: state.history,
                  onOpen: (result) {
                    controller.openResult(result);
                    setState(() => _selectedIndex = 2);
                  },
                ),
                SettingsScreen(
                  baseUrl: state.baseUrl,
                  isDemo: state.isDemo,
                  onSaveUrl: controller.saveApiUrl,
                  onLogout: controller.logout,
                ),
              ],
            ),
          ),
          const SafetyBanner(),
        ],
      ),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _selectedIndex,
        onDestinationSelected: (index) =>
            setState(() => _selectedIndex = index),
        destinations: const [
          NavigationDestination(
            icon: Icon(Icons.videocam_outlined),
            selectedIcon: Icon(Icons.videocam),
            label: 'Cámaras',
          ),
          NavigationDestination(icon: Icon(Icons.search), label: 'Consultar'),
          NavigationDestination(
            icon: Icon(Icons.alt_route),
            label: 'Resultados',
          ),
          NavigationDestination(icon: Icon(Icons.history), label: 'Historial'),
          NavigationDestination(
            icon: Icon(Icons.settings_outlined),
            label: 'Ajustes',
          ),
        ],
      ),
    );
  }
}

class _DemoBadge extends StatelessWidget {
  const _DemoBadge();

  @override
  Widget build(BuildContext context) => Container(
    alignment: Alignment.center,
    padding: const EdgeInsets.symmetric(horizontal: 8),
    decoration: BoxDecoration(
      color: const Color(0xFF4B3718),
      borderRadius: BorderRadius.circular(4),
    ),
    child: const Text(
      'DEMOSTRACIÓN',
      style: TextStyle(
        color: Color(0xFFFFD18A),
        fontSize: 10,
        fontWeight: FontWeight.w800,
      ),
    ),
  );
}
