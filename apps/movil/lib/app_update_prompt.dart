import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:path_provider/path_provider.dart';

import 'app_update.dart';
import 'session.dart';

class AppUpdateState {
  const AppUpdateState({
    this.level = UpdateLevel.none,
    this.release,
    this.installed = installedAppVersionFallback,
    this.promptId = 0,
  });

  final UpdateLevel level;
  final AppRelease? release;
  final String installed;

  /// Changes each time a dialog should appear, including the same version on
  /// the next cold start.
  final int promptId;

  bool get prompts => promptId > 0 && level != UpdateLevel.none;
}

class AppUpdateController extends Notifier<AppUpdateState> {
  static const dismissedVersionKey = 'vigia_update_dismissed_version';
  static const dismissedAtKey = 'vigia_update_dismissed_at';

  http.Client? client;
  Future<String> Function() installedVersion = readInstalledVersion;
  DateTime Function() clock = DateTime.now;

  @override
  AppUpdateState build() => const AppUpdateState();

  Future<void> check({bool opened = false}) async {
    final httpClient = client ?? http.Client();
    final ownsClient = client == null;
    try {
      final release = await fetchAppRelease(
        httpClient,
        ref.read(sessionProvider).baseUrl,
      );
      if (release == null) return;
      final installed = await installedVersion();
      final level = classifyUpdate(installed, release.latest, release.minimum);
      final show = _shouldPrompt(level, release.latest, opened: opened);
      state = AppUpdateState(
        level: level,
        release: release,
        installed: installed,
        promptId: show ? state.promptId + 1 : state.promptId,
      );
    } catch (_) {
      // The notice is not urgent: a unreachable server must not block the app.
    } finally {
      if (ownsClient) httpClient.close();
    }
  }

  bool _shouldPrompt(UpdateLevel level, String? latest, {required bool opened}) {
    if (level == UpdateLevel.none) return false;
    if (level == UpdateLevel.required || opened) return true;
    final preferences = ref.read(preferencesProvider);
    final dismissed = preferences.getString(dismissedVersionKey);
    final at = preferences.getString(dismissedAtKey);
    if (dismissed != latest || at == null) return true;
    final when = DateTime.tryParse(at);
    if (when == null) return true;
    return clock().difference(when) >= const Duration(hours: 24);
  }

  Future<void> dismissOptional() async {
    final latest = state.release?.latest;
    if (state.level != UpdateLevel.optional || latest == null) return;
    final preferences = ref.read(preferencesProvider);
    await preferences.setString(dismissedVersionKey, latest);
    await preferences.setString(dismissedAtKey, clock().toUtc().toIso8601String());
  }
}

final appUpdateProvider = NotifierProvider<AppUpdateController, AppUpdateState>(
  AppUpdateController.new,
);

/// On launch, and again once a day while the process stays alive.
class AppUpdateHost extends ConsumerStatefulWidget {
  const AppUpdateHost({super.key, required this.child});

  final Widget child;

  @override
  ConsumerState<AppUpdateHost> createState() => _AppUpdateHostState();
}

class _AppUpdateHostState extends ConsumerState<AppUpdateHost> {
  Timer? _daily;
  int _shownPrompt = 0;
  bool _dialogOpen = false;

  @override
  void initState() {
    super.initState();
    Future.microtask(() => ref.read(appUpdateProvider.notifier).check(opened: true));
    // A repeating timer never goes idle, and widget tests wait for that.
    final binding = WidgetsBinding.instance.runtimeType.toString();
    if (!binding.endsWith('TestWidgetsFlutterBinding')) {
      _daily = Timer.periodic(const Duration(hours: 24), (_) {
        ref.read(appUpdateProvider.notifier).check();
      });
    }
  }

  @override
  void dispose() {
    _daily?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(appUpdateProvider, (previous, next) {
      if (!next.prompts || next.promptId == _shownPrompt || _dialogOpen) return;
      _shownPrompt = next.promptId;
      _dialogOpen = true;
      WidgetsBinding.instance.addPostFrameCallback((_) async {
        if (!mounted) return;
        await showAppUpdateDialog(context, ref);
        _dialogOpen = false;
      });
    });
    return widget.child;
  }
}

Future<void> showAppUpdateDialog(BuildContext context, WidgetRef ref) async {
  final current = ref.read(appUpdateProvider);
  final release = current.release;
  if (release == null || current.level == UpdateLevel.none) return;
  final requiredUpdate = current.level == UpdateLevel.required;
  await showDialog<void>(
    context: context,
    barrierDismissible: !requiredUpdate,
    builder: (context) => _UpdateDialog(
      installed: current.installed,
      release: release,
      requiredUpdate: requiredUpdate,
      onLater: () async {
        await ref.read(appUpdateProvider.notifier).dismissOptional();
        if (context.mounted) Navigator.of(context).pop();
      },
    ),
  );
}

class _UpdateDialog extends StatefulWidget {
  const _UpdateDialog({
    required this.installed,
    required this.release,
    required this.requiredUpdate,
    required this.onLater,
  });

  final String installed;
  final AppRelease release;
  final bool requiredUpdate;
  final Future<void> Function() onLater;

  @override
  State<_UpdateDialog> createState() => _UpdateDialogState();
}

class _UpdateDialogState extends State<_UpdateDialog> {
  bool _busy = false;
  String? _error;

  Future<void> _update() async {
    final url = widget.release.apkUrl;
    final sha256 = widget.release.sha256;
    if (url == null || sha256 == null) {
      setState(() => _error = 'Esta versión no trae enlace o huella de descarga.');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final client = http.Client();
    try {
      final directory = await getTemporaryDirectory();
      final file = await downloadVerifiedApk(
        client: client,
        url: Uri.parse(url),
        expectedSha256: sha256,
        directory: directory,
      );
      await openApkInstaller(file.path);
    } on UpdateException catch (error) {
      setState(() => _error = error.message);
    } on PlatformException catch (error) {
      setState(() => _error = error.message ?? 'No se pudo abrir el instalador.');
    } catch (_) {
      setState(() => _error = 'No se pudo descargar la actualización.');
    } finally {
      client.close();
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final latest = widget.release.latest ?? 'una más nueva';
    return PopScope(
      canPop: !widget.requiredUpdate,
      child: AlertDialog(
        title: Text(widget.requiredUpdate ? 'Actualización obligatoria' : 'Hay una versión nueva'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              widget.requiredUpdate
                  ? 'La versión instalada (${widget.installed}) quedó por debajo del mínimo. Hay que actualizar para seguir.'
                  : 'La versión instalada es ${widget.installed}. La publicada es $latest. Puedes seguir con esta y actualizar cuando quieras.',
            ),
            if (widget.release.notes.isNotEmpty) ...[
              const SizedBox(height: 10),
              Text(widget.release.notes),
            ],
            const SizedBox(height: 10),
            const Text(
              'Actualizar descarga el APK, comprueba su SHA-256 y abre el instalador. La misma llave de firma lo instala encima y conserva los datos.',
            ),
            if (_error != null) ...[
              const SizedBox(height: 10),
              Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
            ],
          ],
        ),
        actions: [
          if (!widget.requiredUpdate)
            TextButton(onPressed: _busy ? null : widget.onLater, child: const Text('Más tarde')),
          FilledButton(
            onPressed: _busy ? null : _update,
            child: Text(_busy ? 'Comprobando…' : 'Actualizar'),
          ),
        ],
      ),
    );
  }
}

/// Line for the phone-edge status card. Later the node will apply the update
/// and check its own health, the way the central already does.
class EdgeUpdateNotice extends StatelessWidget {
  const EdgeUpdateNotice({super.key, required this.level, this.onUpdate});

  final UpdateLevel level;
  final VoidCallback? onUpdate;

  @override
  Widget build(BuildContext context) {
    if (level == UpdateLevel.none) return const SizedBox.shrink();
    final requiredUpdate = level == UpdateLevel.required;
    final color = requiredUpdate ? const Color(0xFFFFB4AB) : const Color(0xFFFFE1B0);
    return Padding(
      padding: const EdgeInsets.only(top: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(
              requiredUpdate
                  ? 'Esta versión de la app quedó por debajo del mínimo. Hay que actualizar.'
                  : 'Hay una versión más nueva de la app.',
              style: TextStyle(color: color, fontSize: 12),
            ),
          ),
          if (onUpdate != null)
            TextButton(onPressed: onUpdate, child: const Text('Actualizar')),
        ],
      ),
    );
  }
}
