import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:camera/camera.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import '../camera_mode/frame_encoder.dart';
import '../session.dart';
import 'detections.dart';
import 'detector.dart';
import 'edge_config.dart';
import 'edge_engine.dart';
import 'outbox.dart';

final edgeConfigStoreProvider = Provider<EdgeConfigStore>(
  (ref) => DeviceEdgeConfigStore(ref.watch(preferencesProvider)),
);

/// The phone as a complete edge node: it detects vehicles itself with the
/// bundled model and publishes with its own device token. No PC involved.
class EdgeModeScreen extends ConsumerStatefulWidget {
  const EdgeModeScreen({super.key, this.autoStart = false});

  /// Start detecting as soon as the saved configuration loads.
  final bool autoStart;

  @override
  ConsumerState<EdgeModeScreen> createState() => _EdgeModeScreenState();
}

class _EdgeModeScreenState extends ConsumerState<EdgeModeScreen>
    with WidgetsBindingObserver {
  EdgeConfig? _config;
  bool _loading = true;
  bool _starting = false;
  bool _resumeWhenVisible = false;
  CameraController? _camera;
  OnDeviceDetector? _detector;
  EdgeEngine? _engine;
  int _sensorOrientation = 0;
  int _extraRotation = 0;
  int _targetFps = 5;
  int _cameraFrames = 0;
  DateTime _lastFrame = DateTime.fromMillisecondsSinceEpoch(0);
  Timer? _statusTimer;
  String? _error;

  bool get _running => _engine?.running == true;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _loadConfig();
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The OS takes the camera away in the background; pending events stay on disk.
    if (state == AppLifecycleState.paused && _running) {
      _resumeWhenVisible = true;
      _stop();
    } else if (state == AppLifecycleState.resumed && _resumeWhenVisible) {
      _resumeWhenVisible = false;
      _start();
    }
  }

  Future<void> _loadConfig() async {
    final config = await ref.read(edgeConfigStoreProvider).load();
    if (!mounted) return;
    setState(() {
      _config = config;
      _loading = false;
    });
    if (config != null && widget.autoStart) unawaited(_start());
  }

  Future<void> _start() async {
    final config = _config;
    if (config == null || _starting || _running) return;
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final detector = _detector ??= await OnDeviceDetector.load();
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw const _EdgeProblem('Este teléfono no reporta cámaras.');
      }
      final back = cameras.firstWhere(
        (camera) => camera.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      // The model sees 320 px: a medium stream is plenty and keeps copies cheap.
      final controller = CameraController(
        back,
        ResolutionPreset.medium,
        enableAudio: false,
        imageFormatGroup: Platform.isIOS
            ? ImageFormatGroup.bgra8888
            : ImageFormatGroup.yuv420,
      );
      await controller.initialize();
      final support = await getApplicationSupportDirectory();
      final engine = EdgeEngine(
        cameraId: config.cameraId,
        modelName:
            '${detector.manifest.name}-tflite${detector.manifest.inputSize}',
        modelDigest: detector.manifest.digest,
        detect: (frame) async {
          final result = await detector.detect(frame);
          return (detections: result.detections, elapsed: result.elapsed);
        },
        outbox: Outbox(
          directory: Directory(
            '${support.path}/edge_outbox/${config.cameraId}',
          ),
          serverUrl: config.serverUrl,
          token: config.token,
        ),
      )..start();
      _sensorOrientation = back.sensorOrientation;
      _cameraFrames = 0;
      await controller.startImageStream(_onFrame);
      await WakelockPlus.enable();
      _statusTimer = Timer.periodic(
        const Duration(milliseconds: 500),
        (_) => mounted ? setState(() {}) : null,
      );
      setState(() {
        _camera = controller;
        _engine = engine;
      });
    } on CameraException catch (error) {
      setState(
        () => _error = error.code.contains('Access')
            ? 'Sin permiso de cámara. Actívalo en Ajustes del teléfono → Aplicaciones → VIGÍA.'
            : 'No se pudo abrir la cámara (${error.code}).',
      );
      await _stop();
    } on _EdgeProblem catch (problem) {
      setState(() => _error = problem.message);
    } catch (error) {
      setState(
        () => _error = 'No se pudo cargar el modelo de detección ($error).',
      );
      await _stop();
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _onFrame(CameraImage image) {
    _cameraFrames++;
    final engine = _engine;
    final now = DateTime.now();
    if (engine == null ||
        engine.busy ||
        now.difference(_lastFrame) <
            Duration(milliseconds: 1000 ~/ _targetFps)) {
      return; // Frames are dropped while the model works, never queued.
    }
    _lastFrame = now;
    final frame = FrameData(
      format: image.format.group == ImageFormatGroup.bgra8888
          ? FrameFormat.bgra8888
          : FrameFormat.yuv420,
      width: image.width,
      height: image.height,
      planes: [
        for (final plane in image.planes)
          FramePlane(
            bytes: Uint8List.fromList(plane.bytes),
            bytesPerRow: plane.bytesPerRow,
            bytesPerPixel: plane.bytesPerPixel,
          ),
      ],
      rotationDegrees: _sensorOrientation + _extraRotation,
    );
    unawaited(engine.process(frame)); // Failures are counted in engine.stats.
  }

  Future<void> _stop() async {
    _statusTimer?.cancel();
    _statusTimer = null;
    final camera = _camera;
    final engine = _engine;
    _camera = null;
    _engine = null;
    try {
      if (camera?.value.isStreamingImages == true) {
        await camera!.stopImageStream();
      }
    } catch (_) {}
    await camera?.dispose();
    await engine?.stop();
    await WakelockPlus.disable();
    if (mounted) setState(() {});
  }

  Future<void> _forget() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Olvidar este edge'),
        content: const Text(
          'Se borra el token guardado en el teléfono. Para volver a publicar tendrás que pegar un token nuevo o rotarlo desde la app de un administrador.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Olvidar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await _stop();
    await ref.read(edgeConfigStoreProvider).clear();
    if (mounted) setState(() => _config = null);
  }

  @override
  Widget build(BuildContext context) {
    final config = _config;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Edge autónomo'),
        actions: [
          if (config != null)
            IconButton(
              tooltip: 'Olvidar este edge',
              onPressed: _forget,
              icon: const Icon(Icons.key_off_outlined),
            ),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : config == null
          ? EdgeSetupForm(onSaved: (saved) => setState(() => _config = saved))
          : _buildRunning(context, config),
    );
  }

  Widget _buildRunning(BuildContext context, EdgeConfig config) {
    final camera = _camera;
    final engine = _engine;
    final stats = engine?.stats;
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        Text(
          '${config.cameraId} · ${Uri.tryParse(config.serverUrl)?.host ?? config.serverUrl}',
          style: Theme.of(context).textTheme.titleMedium,
        ),
        const SizedBox(height: 4),
        const Text(
          'Este teléfono detecta los vehículos con el modelo integrado y envía solo los eventos al servidor. El video nunca sale del teléfono.',
          style: TextStyle(color: Color(0xFFB7C2BA)),
        ),
        const SizedBox(height: 14),
        if (camera != null && camera.value.isInitialized)
          ClipRRect(
            borderRadius: BorderRadius.circular(6),
            child: AspectRatio(
              aspectRatio: 1 / camera.value.aspectRatio,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  CameraPreview(camera),
                  CustomPaint(
                    painter: _BoxesPainter(
                      engine?.latestDetections ?? const [],
                      _uprightSize(camera),
                      _extraRotation,
                    ),
                  ),
                ],
              ),
            ),
          )
        else
          Container(
            height: 180,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: const Color(0xFF171D1A),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Icon(Icons.memory, size: 42, color: Color(0xFF9AA79F)),
          ),
        const SizedBox(height: 12),
        if (stats != null)
          _EdgeStatusCard(stats: stats, cameraFrames: _cameraFrames),
        if (_error != null) ...[
          const SizedBox(height: 10),
          Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
        ],
        const SizedBox(height: 12),
        SizedBox(
          height: 52,
          child: _running
              ? OutlinedButton.icon(
                  onPressed: _stop,
                  icon: const Icon(Icons.stop_circle_outlined),
                  label: const Text('Detener detección'),
                )
              : FilledButton.icon(
                  onPressed: _starting ? null : _start,
                  icon: _starting
                      ? const SizedBox.square(
                          dimension: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Icon(Icons.play_arrow),
                  label: const Text('Iniciar detección'),
                ),
        ),
        const SizedBox(height: 22),
        Text('Ajustes', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        Row(
          children: [
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: _targetFps,
                decoration: const InputDecoration(
                  labelText: 'Análisis/s (máx.)',
                ),
                items: const [2, 5, 10]
                    .map(
                      (fps) =>
                          DropdownMenuItem(value: fps, child: Text('$fps')),
                    )
                    .toList(),
                onChanged: (value) => setState(() => _targetFps = value ?? 5),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(
              child: DropdownButtonFormField<int>(
                initialValue: _extraRotation,
                decoration: const InputDecoration(labelText: 'Rotación extra'),
                items: const [0, 90, 180, 270]
                    .map(
                      (angle) => DropdownMenuItem(
                        value: angle,
                        child: Text('$angle°'),
                      ),
                    )
                    .toList(),
                onChanged: (value) =>
                    setState(() => _extraRotation = value ?? 0),
              ),
            ),
          ],
        ),
        const SizedBox(height: 6),
        const Text(
          'Menos análisis por segundo ahorra batería y temperatura; 5 basta para tráfico urbano. Usa la rotación si el teléfono queda montado de lado.',
          style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
        ),
        const SizedBox(height: 14),
        const Text(
          'Mantén la app abierta y el teléfono conectado al cargador. Si el sistema la pausa, la detección se detiene, los eventos pendientes quedan guardados y se envían al reanudar.',
          style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
        ),
      ],
    );
  }

  /// Size of the frame the model sees, before the extra rotation.
  Size _uprightSize(CameraController camera) {
    final preview = camera.value.previewSize ?? const Size(1, 1);
    // previewSize is reported in sensor (landscape) orientation.
    return Size(
      math.min(preview.width, preview.height),
      math.max(preview.width, preview.height),
    );
  }
}

/// Draws the model's boxes over the preview. Boxes come in the coordinates of
/// the frame after the extra rotation, so the painter undoes that rotation.
class _BoxesPainter extends CustomPainter {
  _BoxesPainter(this.detections, this.previewFrame, this.extraRotation);

  final List<Detection> detections;
  final Size previewFrame;
  final int extraRotation;

  @override
  void paint(Canvas canvas, Size size) {
    if (detections.isEmpty) return;
    final turned = extraRotation == 90 || extraRotation == 270;
    final uprightWidth = turned ? previewFrame.height : previewFrame.width;
    final uprightHeight = turned ? previewFrame.width : previewFrame.height;
    final scale = size.width / previewFrame.width;
    final stroke = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = 2 / scale
      ..color = const Color(0xFF69D4A8);
    canvas
      ..save()
      ..translate(size.width / 2, size.height / 2)
      ..rotate(-extraRotation * math.pi / 180)
      ..scale(scale)
      ..translate(-uprightWidth / 2, -uprightHeight / 2);
    for (final detection in detections) {
      final box = detection.box;
      canvas.drawRect(Rect.fromLTRB(box.x1, box.y1, box.x2, box.y2), stroke);
      final label = TextPainter(
        text: TextSpan(
          text: '${detection.label} ${(detection.score * 100).round()}%',
          style: TextStyle(
            color: Colors.black,
            fontSize: 11 / scale,
            backgroundColor: const Color(0xFF69D4A8),
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      label.paint(canvas, Offset(box.x1, math.max(0, box.y1 - label.height)));
    }
    canvas.restore();
  }

  @override
  bool shouldRepaint(_BoxesPainter oldDelegate) =>
      oldDelegate.detections != detections ||
      oldDelegate.extraRotation != extraRotation;
}

class _EdgeStatusCard extends StatelessWidget {
  const _EdgeStatusCard({required this.stats, required this.cameraFrames});

  final EdgeStats stats;
  final int cameraFrames;

  @override
  Widget build(BuildContext context) {
    final outbox = stats.outbox;
    final healthy = outbox.lastError == null;
    final muted = const TextStyle(color: Color(0xFF9AA79F), fontSize: 12);
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: healthy ? const Color(0xFF1B2E2A) : const Color(0xFF302517),
        border: Border.all(
          color: healthy ? const Color(0xFF2F5D52) : const Color(0xFF6B5326),
        ),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                healthy ? Icons.sensors : Icons.cloud_off_outlined,
                color: healthy
                    ? const Color(0xFF69D4A8)
                    : const Color(0xFFFFC66D),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  'Detectando · ${stats.fps.toStringAsFixed(1)} análisis/s · '
                  '${stats.activeTracks} vehículo${stats.activeTracks == 1 ? '' : 's'}',
                ),
              ),
            ],
          ),
          const SizedBox(height: 6),
          Text(
            'Inferencia ${stats.inferenceMs} ms · ${stats.snapshots} eventos generados · '
            '${outbox.delivered} enviados · ${outbox.pending} en cola'
            '${outbox.rejected == 0 ? '' : ' · ${outbox.rejected} rechazados'}',
            style: muted,
          ),
          Text(
            'Cámara: $cameraFrames cuadros · modelo: ${stats.framesProcessed} analizados'
            '${stats.failures == 0 ? '' : ' · ${stats.failures} fallidos'}',
            style: muted,
          ),
          if (stats.lastError != null) ...[
            const SizedBox(height: 4),
            Text(
              'Detección: ${stats.lastError}',
              style: const TextStyle(color: Color(0xFFFFB4AB), fontSize: 12),
            ),
          ],
          if (!healthy) ...[
            const SizedBox(height: 4),
            Text(
              _describe(outbox.lastError!),
              style: const TextStyle(color: Color(0xFFFFE1B0), fontSize: 12),
            ),
          ],
        ],
      ),
    );
  }

  static String _describe(String code) => switch (code) {
    'NETWORK' || 'TIMEOUT' => 'Sin conexión con el servidor: los eventos se guardan y se enviarán al volver la red.',
    'HTTP_401' => 'El servidor rechazó el token (vencido o revocado). Olvida este edge y configura uno nuevo.',
    'HTTP_403' => 'El token pertenece a otra cámara.',
    'HTTP_404' => 'La cámara ya no está registrada en el servidor.',
    'OUTBOX_FULL' => 'La cola local está llena; se descartan eventos nuevos hasta recuperar conexión.',
    _ when code.startsWith('REJECTED_') =>
      'El servidor rechazó un evento (${code.substring(9)}); se apartó y el resto sigue.',
    _ => 'Último error: $code',
  };
}

/// First-time setup: camera id, server and token, verified before saving.
class EdgeSetupForm extends ConsumerStatefulWidget {
  const EdgeSetupForm({super.key, required this.onSaved});

  final ValueChanged<EdgeConfig> onSaved;

  @override
  ConsumerState<EdgeSetupForm> createState() => _EdgeSetupFormState();
}

class _EdgeSetupFormState extends ConsumerState<EdgeSetupForm> {
  final _formKey = GlobalKey<FormState>();
  final _cameraController = TextEditingController();
  late final _serverController = TextEditingController(
    text: ref.read(sessionProvider).baseUrl,
  );
  final _tokenController = TextEditingController();
  bool _saving = false;
  String? _error;

  @override
  void dispose() {
    _cameraController.dispose();
    _serverController.dispose();
    _tokenController.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    final config = EdgeConfig(
      cameraId: _cameraController.text.trim().toUpperCase(),
      serverUrl: _serverController.text.trim().replaceAll(RegExp(r'/+$'), ''),
      token: _tokenController.text.trim(),
    );
    final problem = await verifyEdgeToken(config);
    if (!mounted) return;
    if (problem != null) {
      setState(() {
        _saving = false;
        _error = problem;
      });
      return;
    }
    await ref.read(edgeConfigStoreProvider).save(config);
    _tokenController.clear();
    widget.onSaved(config);
  }

  @override
  Widget build(BuildContext context) => Form(
    key: _formKey,
    child: ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const Text(
          'Configura este teléfono como un edge completo: detecta vehículos sin PC y publica con su propio token.',
          style: TextStyle(color: Color(0xFFB7C2BA)),
        ),
        const SizedBox(height: 8),
        const Text(
          'Un administrador registra la cámara en "Agregar edge" (fuente: este teléfono). Si lo haces desde este mismo teléfono, el token se guarda solo y no hace falta pegarlo.',
          style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
        ),
        const SizedBox(height: 18),
        TextFormField(
          controller: _cameraController,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'Identificador de la cámara',
            hintText: 'CEL-02',
            prefixIcon: Icon(Icons.tag),
          ),
          validator: (value) => (value ?? '').trim().isEmpty
              ? 'Escribe el identificador registrado.'
              : null,
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _serverController,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: const InputDecoration(
            labelText: 'Servidor central',
            prefixIcon: Icon(Icons.dns_outlined),
          ),
          validator: (value) {
            final uri = Uri.tryParse((value ?? '').trim());
            return uri == null ||
                    !uri.isScheme('https') && !uri.isScheme('http') ||
                    uri.host.isEmpty
                ? 'Usa la URL completa, p. ej. https://servidor.'
                : null;
          },
        ),
        const SizedBox(height: 12),
        TextFormField(
          controller: _tokenController,
          obscureText: true,
          autocorrect: false,
          enableSuggestions: false,
          decoration: const InputDecoration(
            labelText: 'Token del edge',
            prefixIcon: Icon(Icons.key_outlined),
          ),
          validator: (value) => (value ?? '').trim().length < 20
              ? 'Pega el token completo.'
              : null,
        ),
        if (_error != null) ...[
          const SizedBox(height: 14),
          Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
        ],
        const SizedBox(height: 20),
        SizedBox(
          height: 52,
          child: FilledButton.icon(
            onPressed: _saving ? null : _save,
            icon: _saving
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.verified_user_outlined),
            label: const Text('Verificar y guardar'),
          ),
        ),
        const SizedBox(height: 10),
        const Text(
          'El token se guarda cifrado en el almacenamiento seguro del teléfono y nunca se muestra de nuevo.',
          style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
        ),
      ],
    ),
  );
}

class _EdgeProblem implements Exception {
  const _EdgeProblem(this.message);
  final String message;
}
