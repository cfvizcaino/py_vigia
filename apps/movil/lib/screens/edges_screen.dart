import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../api_client.dart';
import '../models.dart';
import '../session.dart';
import '../widgets/map_panel.dart';
import '../widgets/shared_widgets.dart';

final _cameraIdPattern = RegExp(r'^[A-Z0-9][A-Z0-9-]{1,63}$');

/// Next free phone identifier: CEL-01, CEL-02…
String suggestEdgeId(List<Device> devices) {
  final used = devices
      .map((device) => RegExp(r'^CEL-(\d+)$').firstMatch(device.externalId))
      .whereType<RegExpMatch>()
      .map((match) => int.parse(match.group(1)!))
      .toSet();
  var next = 1;
  while (used.contains(next)) {
    next++;
  }
  return 'CEL-${next.toString().padLeft(2, '0')}';
}

String? validateEdgeId(String? value, List<Device> devices) {
  final id = (value ?? '').trim();
  if (!_cameraIdPattern.hasMatch(id)) {
    return 'Usa mayúsculas, números y guiones (p. ej. CEL-02).';
  }
  if (devices.any((device) => device.externalId == id)) {
    return 'Ya existe una cámara con ese identificador.';
  }
  return null;
}

class AddEdgeScreen extends ConsumerStatefulWidget {
  const AddEdgeScreen({super.key});

  @override
  ConsumerState<AddEdgeScreen> createState() => _AddEdgeScreenState();
}

class _AddEdgeScreenState extends ConsumerState<AddEdgeScreen> {
  final _formKey = GlobalKey<FormState>();
  late final TextEditingController _idController;
  final _nameController = TextEditingController();
  final _modelController = TextEditingController();
  LatLng? _point;
  double? _accuracyM;
  int _days = 90;
  bool _locating = false;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _idController = TextEditingController(
      text: suggestEdgeId(ref.read(sessionProvider).devices),
    );
  }

  @override
  void dispose() {
    _idController.dispose();
    _nameController.dispose();
    _modelController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final devices = ref.watch(sessionProvider).devices;
    final LatLng center = devices.isNotEmpty
        ? LatLng(devices.first.lat, devices.first.lng)
        : const LatLng(11.0131, -74.8172);
    return Scaffold(
      appBar: AppBar(title: const Text('Agregar edge')),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
          children: [
            const Text(
              'Registra la cámara en el servidor y emite su credencial. El nodo de visión que la procese usará ese token para publicar.',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            const SizedBox(height: 18),
            TextFormField(
              controller: _idController,
              textCapitalization: TextCapitalization.characters,
              decoration: const InputDecoration(
                labelText: 'Identificador',
                helperText: 'Estable y único; no se puede cambiar después.',
                prefixIcon: Icon(Icons.tag),
              ),
              validator: (value) => validateEdgeId(value, devices),
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _nameController,
              decoration: const InputDecoration(
                labelText: 'Nombre visible',
                hintText: 'Teléfono portería norte',
                prefixIcon: Icon(Icons.label_outline),
              ),
              validator: (value) => (value ?? '').trim().isEmpty
                  ? 'Escribe un nombre para reconocerla.'
                  : null,
            ),
            const SizedBox(height: 12),
            TextFormField(
              controller: _modelController,
              decoration: const InputDecoration(
                labelText: 'Equipo (opcional)',
                hintText: 'OPPO CPH2599',
                prefixIcon: Icon(Icons.smartphone),
              ),
            ),
            const SizedBox(height: 22),
            Text('Ubicación', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            const Text(
              'Donde quedará la cámara. Las rutas dependen de este punto.',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 48,
              child: OutlinedButton.icon(
                onPressed: _locating ? null : _useMyLocation,
                icon: _locating
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.my_location),
                label: const Text('Usar mi ubicación actual'),
              ),
            ),
            const SizedBox(height: 10),
            MapPanel(
              // The map only reads its center once: rebuild it when GPS moves the point.
              key: ValueKey(_accuracyM == null ? 'manual' : _point),
              devices: devices,
              selectedPoint: _point ?? center,
              height: 240,
              onPointSelected: (point) => setState(() {
                _point = point;
                _accuracyM = null;
              }),
            ),
            const SizedBox(height: 6),
            Text(
              _point == null
                  ? 'Toca el mapa o usa tu ubicación.'
                  : '${_point!.latitude.toStringAsFixed(6)}, ${_point!.longitude.toStringAsFixed(6)}'
                        '${_accuracyM == null ? ' · elegida en el mapa' : ' · GPS ±${_accuracyM!.round()} m'}',
              style: TextStyle(
                color: _point == null
                    ? const Color(0xFFFFD18A)
                    : const Color(0xFFB7C2BA),
              ),
            ),
            const SizedBox(height: 22),
            DropdownButtonFormField<int>(
              initialValue: _days,
              decoration: const InputDecoration(
                labelText: 'Vigencia del token',
                prefixIcon: Icon(Icons.key_outlined),
              ),
              items: const [30, 90, 180, 365]
                  .map(
                    (days) => DropdownMenuItem(
                      value: days,
                      child: Text('$days días'),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() => _days = value ?? 90),
            ),
            if (_error != null) ...[
              const SizedBox(height: 14),
              Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
            ],
            const SizedBox(height: 20),
            SizedBox(
              height: 52,
              child: FilledButton.icon(
                onPressed: _saving ? null : _submit,
                icon: _saving
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.add_task),
                label: const Text('Registrar edge y emitir token'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _useMyLocation() async {
    setState(() {
      _locating = true;
      _error = null;
    });
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        throw const _LocationProblem('Activa la ubicación del teléfono.');
      }
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.denied ||
          permission == LocationPermission.deniedForever) {
        throw const _LocationProblem(
          'Sin permiso de ubicación. Puedes elegir el punto en el mapa.',
        );
      }
      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(
          accuracy: LocationAccuracy.high,
          timeLimit: Duration(seconds: 20),
        ),
      );
      setState(() {
        _point = LatLng(position.latitude, position.longitude);
        _accuracyM = position.accuracy;
      });
    } on _LocationProblem catch (problem) {
      setState(() => _error = problem.message);
    } catch (_) {
      setState(
        () => _error =
            'No se obtuvo la ubicación a tiempo. Elige el punto en el mapa.',
      );
    } finally {
      if (mounted) setState(() => _locating = false);
    }
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (_point == null) {
      setState(() => _error = 'Falta la ubicación de la cámara.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      final result = await ref
          .read(sessionProvider.notifier)
          .addEdge(
            cameraId: _idController.text.trim(),
            name: _nameController.text.trim(),
            lat: _point!.latitude,
            lng: _point!.longitude,
            cameraModel: _modelController.text.trim(),
            days: _days,
          );
      if (!mounted) return;
      if (result.issued == null) {
        // The camera exists; the token can be issued from its detail sheet.
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Edge registrado, pero no se emitió el token: ${result.error}',
            ),
          ),
        );
        return;
      }
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) => IssuedTokenScreen(issued: result.issued!),
        ),
      );
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

class _LocationProblem implements Exception {
  const _LocationProblem(this.message);
  final String message;
}

/// Shows the token once. Nothing keeps it after this screen closes.
class IssuedTokenScreen extends StatefulWidget {
  const IssuedTokenScreen({super.key, required this.issued});

  final IssuedCredential issued;

  @override
  State<IssuedTokenScreen> createState() => _IssuedTokenScreenState();
}

class _IssuedTokenScreenState extends State<IssuedTokenScreen> {
  bool _copied = false;

  @override
  Widget build(BuildContext context) {
    final cameraId = widget.issued.credential.cameraId;
    final command = 'bash infra/edges/install-node-token.sh $cameraId';
    return Scaffold(
      appBar: AppBar(
        title: Text('Token de $cameraId'),
        automaticallyImplyLeading: false,
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
        children: [
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: const Color(0xFF302517),
              borderRadius: BorderRadius.circular(6),
            ),
            child: const Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Icon(Icons.warning_amber_rounded, color: Color(0xFFFFC66D)),
                SizedBox(width: 10),
                Expanded(
                  child: Text(
                    'Copia este token ahora: no se volverá a mostrar. No lo envíes por chat ni correo; pégalo directamente en el PC del nodo.',
                    style: TextStyle(color: Color(0xFFFFE1B0)),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: const Color(0xFF171D1A),
              border: Border.all(color: const Color(0xFF303A34)),
              borderRadius: BorderRadius.circular(6),
            ),
            child: SelectableText(
              widget.issued.secret,
              style: const TextStyle(fontFamily: 'monospace', fontSize: 14),
            ),
          ),
          const SizedBox(height: 10),
          SizedBox(
            height: 48,
            child: FilledButton.tonalIcon(
              onPressed: () async {
                await Clipboard.setData(
                  ClipboardData(text: widget.issued.secret),
                );
                setState(() => _copied = true);
              },
              icon: Icon(_copied ? Icons.check : Icons.copy),
              label: Text(_copied ? 'Copiado' : 'Copiar token'),
            ),
          ),
          const SizedBox(height: 22),
          Text(
            'En el PC del nodo',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 8),
          const Text(
            'Desde la carpeta del proyecto, ejecuta este comando y pega el token cuando lo pida (no se muestra al escribir):',
            style: TextStyle(color: Color(0xFFB7C2BA)),
          ),
          const SizedBox(height: 8),
          SelectableText(
            command,
            style: const TextStyle(fontFamily: 'monospace'),
          ),
          const SizedBox(height: 6),
          Text(
            'Vence: ${formatBogota(widget.issued.credential.expiresAt)} (hora de Colombia).',
            style: const TextStyle(color: Color(0xFFB7C2BA), fontSize: 12),
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 52,
            child: OutlinedButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Ya lo guardé'),
            ),
          ),
        ],
      ),
    );
  }
}

/// Admin sheet for one edge: its credentials, rotation and revocation.
class EdgeDetailSheet extends ConsumerStatefulWidget {
  const EdgeDetailSheet({super.key, required this.device});

  final Device device;

  @override
  ConsumerState<EdgeDetailSheet> createState() => _EdgeDetailSheetState();
}

class _EdgeDetailSheetState extends ConsumerState<EdgeDetailSheet> {
  late Future<List<EdgeCredential>> _credentials = _load();
  bool _busy = false;

  Future<List<EdgeCredential>> _load() => ref
      .read(sessionProvider.notifier)
      .credentialsFor(widget.device.externalId);

  @override
  Widget build(BuildContext context) => SafeArea(
    child: Padding(
      padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  widget.device.externalId,
                  style: Theme.of(context).textTheme.titleLarge,
                ),
              ),
              StatusTag(status: widget.device.status),
            ],
          ),
          Text(
            '${widget.device.name}${widget.device.cameraModel == null ? '' : ' · ${widget.device.cameraModel}'}',
            style: const TextStyle(color: Color(0xFFB7C2BA)),
          ),
          const Divider(height: 24),
          Text('Credenciales', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 6),
          FutureBuilder<List<EdgeCredential>>(
            future: _credentials,
            builder: (context, snapshot) {
              if (snapshot.connectionState != ConnectionState.done) {
                return const Padding(
                  padding: EdgeInsets.all(16),
                  child: Center(child: CircularProgressIndicator()),
                );
              }
              if (snapshot.hasError) {
                return Text(
                  snapshot.error is ApiException
                      ? (snapshot.error as ApiException).message
                      : 'No fue posible cargar las credenciales.',
                  style: const TextStyle(color: Color(0xFFFFB4AB)),
                );
              }
              final items = snapshot.data!;
              if (items.isEmpty) {
                return const Text(
                  'Sin credenciales: el nodo no puede publicar.',
                );
              }
              return Column(
                children: items
                    .map(
                      (credential) => ListTile(
                        contentPadding: EdgeInsets.zero,
                        leading: Icon(
                          credential.active ? Icons.key : Icons.key_off,
                          color: credential.active
                              ? const Color(0xFF69D4A8)
                              : const Color(0xFF9AA79F),
                        ),
                        title: Text(
                          credential.revoked
                              ? 'Revocada'
                              : credential.active
                              ? 'Activa'
                              : 'Vencida',
                        ),
                        subtitle: Text(
                          'Emitida ${formatBogota(credential.createdAt)} · vence ${formatBogota(credential.expiresAt)}',
                        ),
                        trailing: credential.active
                            ? TextButton(
                                onPressed: _busy
                                    ? null
                                    : () => _revoke(credential),
                                child: const Text('Revocar'),
                              )
                            : null,
                      ),
                    )
                    .toList(),
              );
            },
          ),
          const SizedBox(height: 12),
          SizedBox(
            height: 48,
            child: FilledButton.tonalIcon(
              onPressed: _busy ? null : _issue,
              icon: const Icon(Icons.vpn_key_outlined),
              label: const Text('Emitir nueva credencial'),
            ),
          ),
          const SizedBox(height: 6),
          const Text(
            'Para rotar: emite una nueva, instálala en el nodo y después revoca la anterior.',
            style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
          ),
        ],
      ),
    ),
  );

  Future<void> _issue() async {
    setState(() => _busy = true);
    try {
      final issued = await ref
          .read(sessionProvider.notifier)
          .issueCredential(widget.device.externalId);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => IssuedTokenScreen(issued: issued),
        ),
      );
      setState(() => _credentials = _load());
    } on ApiException catch (error) {
      _show(error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _revoke(EdgeCredential credential) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Revocar credencial?'),
        content: Text(
          '${widget.device.externalId} dejará de publicar con este token. Los eventos pendientes quedan en su cola.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Revocar'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    setState(() => _busy = true);
    try {
      await ref.read(sessionProvider.notifier).revokeCredential(credential.id);
      setState(() => _credentials = _load());
    } on ApiException catch (error) {
      _show(error.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _show(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(SnackBar(content: Text(message)));
  }
}
