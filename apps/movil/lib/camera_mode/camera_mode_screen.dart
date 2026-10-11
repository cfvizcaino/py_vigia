import 'dart:async';
import 'dart:io';
import 'dart:math';

import 'package:camera/camera.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:wakelock_plus/wakelock_plus.dart';

import 'frame_encoder.dart';
import 'mjpeg_server.dart';

enum CameraLink { usb, lan }

const cameraPort = 8080;

/// Random access key for LAN mode, without ambiguous characters.
String newAccessKey([Random? random]) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  final generator = random ?? Random.secure();
  return List.generate(
    12,
    (_) => alphabet[generator.nextInt(alphabet.length)],
  ).join();
}

/// Turns the phone into the IP camera of an edge node: the node on a PC reads
/// `/video`, detects vehicles and publishes with its own device token.
class CameraModeScreen extends StatefulWidget {
  const CameraModeScreen({super.key});

  @override
  State<CameraModeScreen> createState() => _CameraModeScreenState();
}

class _CameraModeScreenState extends State<CameraModeScreen>
    with WidgetsBindingObserver {
  CameraController? _camera;
  MjpegServer? _server;
  CameraLink _link = CameraLink.usb;
  String _accessKey = newAccessKey();
  int _targetFps = 8;
  int _extraRotation = 0;
  bool _starting = false;
  bool _encoding = false;
  bool _resumeWhenVisible = false;
  DateTime _lastFrame = DateTime.fromMillisecondsSinceEpoch(0);
  List<String> _addresses = const [];
  String? _error;
  Timer? _statusTimer;

  bool get _streaming => _server?.running == true && _camera != null;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _stop();
    super.dispose();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // The OS takes the camera away in the background: release it and resume later.
    if (state == AppLifecycleState.paused && _streaming) {
      _resumeWhenVisible = true;
      _stop();
    } else if (state == AppLifecycleState.resumed && _resumeWhenVisible) {
      _resumeWhenVisible = false;
      _start();
    }
  }

  Future<void> _start() async {
    setState(() {
      _starting = true;
      _error = null;
    });
    try {
      final cameras = await availableCameras();
      if (cameras.isEmpty) {
        throw const _CameraProblem('Este teléfono no reporta cámaras.');
      }
      final back = cameras.firstWhere(
        (camera) => camera.lensDirection == CameraLensDirection.back,
        orElse: () => cameras.first,
      );
      final controller = CameraController(
        back,
        ResolutionPreset.high,
        enableAudio: false,
        imageFormatGroup: Platform.isIOS
            ? ImageFormatGroup.bgra8888
            : ImageFormatGroup.yuv420,
      );
      await controller.initialize();
      final server = MjpegServer(
        accessKey: _link == CameraLink.lan ? _accessKey : null,
      );
      // USB mode listens only on the phone itself: reachable just through adb forward.
      await server.start(
        address: _link == CameraLink.usb
            ? InternetAddress.loopbackIPv4
            : InternetAddress.anyIPv4,
        port: cameraPort,
      );
      final addresses = _link == CameraLink.lan
          ? await localNetworkAddresses()
          : const <String>[];
      await controller.startImageStream(
        (image) => _onFrame(image, back.sensorOrientation),
      );
      await WakelockPlus.enable();
      _statusTimer = Timer.periodic(
        const Duration(seconds: 1),
        (_) => mounted ? setState(() {}) : null,
      );
      setState(() {
        _camera = controller;
        _server = server;
        _addresses = addresses;
      });
    } on CameraException catch (error) {
      setState(
        () => _error = error.code.contains('Access')
            ? 'Sin permiso de cámara. Actívalo en Ajustes del teléfono → Aplicaciones → VIGÍA.'
            : 'No se pudo abrir la cámara (${error.code}).',
      );
      await _stop();
    } on SocketException {
      setState(
        () => _error =
            'El puerto $cameraPort está ocupado (¿IP Webcam abierta?). Ciérrala e intenta de nuevo.',
      );
      await _stop();
    } on _CameraProblem catch (problem) {
      setState(() => _error = problem.message);
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _onFrame(CameraImage image, int sensorOrientation) {
    final server = _server;
    final now = DateTime.now();
    if (server == null ||
        _encoding ||
        now.difference(_lastFrame) <
            Duration(milliseconds: 1000 ~/ _targetFps)) {
      return; // Skip frames while busy or above the target rate.
    }
    _encoding = true;
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
      rotationDegrees: sensorOrientation + _extraRotation,
    );
    compute(encodeFrame, frame)
        .then(server.publish, onError: (_) {})
        .whenComplete(() => _encoding = false);
  }

  Future<void> _stop() async {
    _statusTimer?.cancel();
    _statusTimer = null;
    final camera = _camera;
    final server = _server;
    _camera = null;
    _server = null;
    try {
      if (camera?.value.isStreamingImages == true) {
        await camera!.stopImageStream();
      }
    } catch (_) {}
    await camera?.dispose();
    await server?.stop();
    await WakelockPlus.disable();
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final server = _server;
    final camera = _camera;
    return Scaffold(
      appBar: AppBar(title: const Text('Modo cámara')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          const Text(
            'Este teléfono transmite su cámara a un nodo VIGÍA en un PC, que detecta los vehículos y publica con el token del edge. El video no va al servidor central.',
            style: TextStyle(color: Color(0xFFB7C2BA)),
          ),
          const SizedBox(height: 16),
          SegmentedButton<CameraLink>(
            segments: const [
              ButtonSegment(
                value: CameraLink.usb,
                icon: Icon(Icons.usb),
                label: Text('Cable USB'),
              ),
              ButtonSegment(
                value: CameraLink.lan,
                icon: Icon(Icons.wifi),
                label: Text('Red local'),
              ),
            ],
            selected: {_link},
            onSelectionChanged: _streaming
                ? null
                : (value) => setState(() => _link = value.first),
          ),
          const SizedBox(height: 8),
          Text(
            _link == CameraLink.usb
                ? 'Recomendado: el video solo sale por el cable; nadie en la red puede verlo.'
                : 'Cualquiera en tu Wi-Fi podría intentar conectarse: el acceso exige la clave.',
            style: const TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
          ),
          const SizedBox(height: 14),
          if (camera != null && camera.value.isInitialized)
            ClipRRect(
              borderRadius: BorderRadius.circular(6),
              child: AspectRatio(
                aspectRatio: 1 / camera.value.aspectRatio,
                child: CameraPreview(camera),
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
              child: const Icon(
                Icons.videocam_off_outlined,
                size: 42,
                color: Color(0xFF9AA79F),
              ),
            ),
          const SizedBox(height: 12),
          if (server != null && server.running)
            _StatusCard(
              fps: server.fps,
              clients: server.clients,
              frames: server.framesPublished,
            ),
          if (_error != null) ...[
            const SizedBox(height: 10),
            Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
          ],
          const SizedBox(height: 12),
          SizedBox(
            height: 52,
            child: _streaming
                ? OutlinedButton.icon(
                    onPressed: _stop,
                    icon: const Icon(Icons.stop_circle_outlined),
                    label: const Text('Detener transmisión'),
                  )
                : FilledButton.icon(
                    onPressed: _starting ? null : _start,
                    icon: _starting
                        ? const SizedBox.square(
                            dimension: 18,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.videocam),
                    label: const Text('Iniciar transmisión'),
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
                  decoration: const InputDecoration(labelText: 'Fotogramas/s'),
                  items: const [5, 8, 12, 15]
                      .map(
                        (fps) =>
                            DropdownMenuItem(value: fps, child: Text('$fps')),
                      )
                      .toList(),
                  onChanged: (value) => setState(() => _targetFps = value ?? 8),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: DropdownButtonFormField<int>(
                  initialValue: _extraRotation,
                  decoration: const InputDecoration(
                    labelText: 'Rotación extra',
                  ),
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
            'Usa la rotación si el teléfono queda montado de lado y la imagen llega girada: YOLO detecta mejor con la imagen derecha.',
            style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
          ),
          const SizedBox(height: 22),
          Text(
            'En el PC del nodo',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          if (_link == CameraLink.usb) ...const [
            Text(
              '1. Conecta este teléfono por USB con la depuración activada.\n'
              '2. Ejecuta (redirige el puerto por el cable y enciende el nodo):',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            SizedBox(height: 6),
            SelectableText(
              'bash infra/edges/run-phone-node.sh CEL-XX',
              style: TextStyle(fontFamily: 'monospace'),
            ),
          ] else ...[
            const Text(
              'Instala el nodo con esta fuente; el script pedirá usuario y contraseña: usuario "vigia" y la clave de abajo.',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            const SizedBox(height: 6),
            for (final address
                in _addresses.isEmpty ? ['IP_DEL_TELEFONO'] : _addresses)
              SelectableText(
                'bash infra/edges/install-node-token.sh CEL-XX http://$address:$cameraPort/video URL_SERVIDOR --auth',
                style: const TextStyle(fontFamily: 'monospace'),
              ),
            const SizedBox(height: 10),
            Row(
              children: [
                Expanded(
                  child: SelectableText(
                    'Clave: $_accessKey',
                    style: const TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 16,
                    ),
                  ),
                ),
                TextButton(
                  onPressed: _streaming
                      ? null
                      : () => setState(() => _accessKey = newAccessKey()),
                  child: const Text('Nueva clave'),
                ),
              ],
            ),
          ],
          const SizedBox(height: 14),
          const Text(
            'Mantén la app abierta mientras transmite (la pantalla no se apagará). Si el sistema la pausa, la transmisión se detiene y se reanuda al volver.',
            style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.fps,
    required this.clients,
    required this.frames,
  });

  final double fps;
  final int clients;
  final int frames;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFF1B2E2A),
      border: Border.all(color: const Color(0xFF2F5D52)),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Row(
      children: [
        const Icon(Icons.sensors, color: Color(0xFF69D4A8)),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            'Transmitiendo · ${fps.toStringAsFixed(1)} fps · '
            '${clients == 0 ? 'esperando al nodo' : '$clients nodo${clients == 1 ? '' : 's'} conectado${clients == 1 ? '' : 's'}'}',
          ),
        ),
        Text('$frames', style: const TextStyle(color: Color(0xFF9AA79F))),
      ],
    ),
  );
}

class _CameraProblem implements Exception {
  const _CameraProblem(this.message);
  final String message;
}
