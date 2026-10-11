import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../api_client.dart';
import '../edge_mode/edge_config.dart';
import '../edge_mode/edge_mode_screen.dart';
import '../edge_source.dart';
import '../models.dart';
import '../session.dart';
import '../widgets/location_picker.dart';
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
  int _days = 90;
  EdgeSource _source = EdgeSource.phoneUsb;
  late final TextEditingController _sourceController;
  bool _needsAuth = EdgeSource.phoneUsb.authByDefault;
  bool _saving = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _idController = TextEditingController(
      text: suggestEdgeId(ref.read(sessionProvider).devices),
    );
    _sourceController = TextEditingController(
      text: suggestPhonePort(_idController.text),
    );
  }

  @override
  void dispose() {
    _idController.dispose();
    _nameController.dispose();
    _modelController.dispose();
    _sourceController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final devices = ref.watch(sessionProvider).devices;
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
            LocationPicker(
              devices: devices,
              onChanged: (point, _) => setState(() => _point = point),
            ),
            const SizedBox(height: 22),
            Text(
              'Fuente de video',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            const Text(
              'Este teléfono puede detectar por sí mismo, o un nodo en un PC lee la cámara. Para un PC solo se usa para armar el comando de instalación; no se envía al servidor.',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            const SizedBox(height: 10),
            DropdownButtonFormField<EdgeSource>(
              initialValue: _source,
              isExpanded: true,
              decoration: const InputDecoration(
                prefixIcon: Icon(Icons.settings_input_antenna),
              ),
              items: EdgeSource.values
                  .map(
                    (source) => DropdownMenuItem(
                      value: source,
                      child: Text(
                        source.label,
                        overflow: TextOverflow.ellipsis,
                      ),
                    ),
                  )
                  .toList(),
              onChanged: (value) => setState(() {
                _source = value ?? EdgeSource.phoneUsb;
                _needsAuth = _source.authByDefault;
                _sourceController.text = _source == EdgeSource.phoneUsb
                    ? suggestPhonePort(_idController.text)
                    : '';
              }),
            ),
            if (_source.needsNodePc) ...[
              const SizedBox(height: 10),
              TextFormField(
                key: ValueKey(_source),
                controller: _sourceController,
                autocorrect: false,
                keyboardType: _source == EdgeSource.phoneUsb
                    ? TextInputType.number
                    : TextInputType.url,
                decoration: InputDecoration(
                  labelText: _source.fieldLabel,
                  hintText: _source.hint,
                ),
                validator: (value) => validateSource(_source, value ?? ''),
              ),
            ] else
              const Padding(
                padding: EdgeInsets.only(top: 8),
                child: Text(
                  'Usa el modelo integrado: el teléfono detecta los vehículos y publica con su propio token. Ideal para cualquier Android con cámara trasera.',
                  style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
                ),
              ),
            if (_source == EdgeSource.rtsp || _source == EdgeSource.http)
              CheckboxListTile(
                contentPadding: EdgeInsets.zero,
                value: _needsAuth,
                onChanged: (value) =>
                    setState(() => _needsAuth = value ?? false),
                title: const Text('La cámara pide usuario y contraseña'),
                subtitle: const Text(
                  'El script del PC los pedirá sin mostrarlos.',
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
      if (!_source.needsNodePc) {
        await Navigator.of(context).pushReplacement(
          MaterialPageRoute<void>(
            builder: (_) =>
                IssuedTokenScreen(issued: result.issued!, autonomous: true),
          ),
        );
        return;
      }
      final command = installCommand(
        cameraId: result.device.externalId,
        source: _source,
        value: _sourceController.text,
        serverUrl: ref.read(sessionProvider).baseUrl,
        needsAuth: _needsAuth,
      );
      await Navigator.of(context).pushReplacement(
        MaterialPageRoute<void>(
          builder: (_) =>
              IssuedTokenScreen(issued: result.issued!, command: command),
        ),
      );
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}

/// Shows the token once. Nothing keeps it after this screen closes.
class IssuedTokenScreen extends ConsumerStatefulWidget {
  const IssuedTokenScreen({
    super.key,
    required this.issued,
    this.command,
    this.autonomous = false,
  });

  final IssuedCredential issued;

  /// Install command with the chosen video source; generic when rotating.
  final String? command;

  /// The edge detects on a phone: no PC command, the token goes into the app.
  final bool autonomous;

  @override
  ConsumerState<IssuedTokenScreen> createState() => _IssuedTokenScreenState();
}

class _IssuedTokenScreenState extends ConsumerState<IssuedTokenScreen> {
  bool _copied = false;
  bool _saving = false;
  String? _saveError;

  /// Keeps the token in this phone's secure storage and opens the edge, so it
  /// is never copied anywhere.
  Future<void> _useHere() async {
    setState(() {
      _saving = true;
      _saveError = null;
    });
    final config = EdgeConfig(
      cameraId: widget.issued.credential.cameraId,
      serverUrl: ref.read(sessionProvider).baseUrl,
      token: widget.issued.secret,
    );
    final problem = await verifyEdgeToken(config);
    if (!mounted) return;
    if (problem != null) {
      setState(() {
        _saving = false;
        _saveError = problem;
      });
      return;
    }
    await ref.read(edgeConfigStoreProvider).save(config);
    if (!mounted) return;
    await Navigator.of(context).pushReplacement(
      MaterialPageRoute<void>(builder: (_) => const EdgeModeScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    final cameraId = widget.issued.credential.cameraId;
    final command =
        widget.command ??
        'bash infra/edges/install-node-token.sh $cameraId FUENTE URL_SERVIDOR';
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
                    'Copia este token ahora: no se volverá a mostrar. No lo envíes por chat ni correo; pégalo directamente en el PC del nodo o en el teléfono del edge.',
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
          if (widget.autonomous || widget.command == null) ...[
            const SizedBox(height: 22),
            Text(
              'Edge autónomo (detección en el teléfono)',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 8),
            const Text(
              'Si este es el teléfono que quedará como cámara, guárdalo aquí: el token se queda cifrado en el teléfono y no hay que copiarlo. Si es otro teléfono, ábrelo en VIGÍA → "Edge autónomo" y pega el token.',
              style: TextStyle(color: Color(0xFFB7C2BA)),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 48,
              child: FilledButton.icon(
                onPressed: _saving ? null : _useHere,
                icon: _saving
                    ? const SizedBox.square(
                        dimension: 18,
                        child: CircularProgressIndicator(strokeWidth: 2),
                      )
                    : const Icon(Icons.memory),
                label: const Text('Usar en este teléfono'),
              ),
            ),
            if (_saveError != null) ...[
              const SizedBox(height: 8),
              Text(
                _saveError!,
                style: const TextStyle(color: Color(0xFFFFB4AB)),
              ),
            ],
          ],
          if (!widget.autonomous) ...[
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
          ],
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

/// Detail of one camera: its recent detections for everyone; location and
/// credentials (rotation, revocation) for admins. The backend enforces roles.
class EdgeDetailSheet extends ConsumerStatefulWidget {
  const EdgeDetailSheet({
    super.key,
    required this.device,
    this.isAdmin = false,
  });

  final Device device;
  final bool isAdmin;

  @override
  ConsumerState<EdgeDetailSheet> createState() => _EdgeDetailSheetState();
}

class _EdgeDetailSheetState extends ConsumerState<EdgeDetailSheet> {
  late final Future<List<DeviceDetection>> _detections = ref
      .read(sessionProvider.notifier)
      .recentDetections(widget.device);
  late Future<List<EdgeCredential>> _credentials = _loadCredentials();
  bool _busy = false;

  Future<List<EdgeCredential>> _loadCredentials() => widget.isAdmin
      ? ref
            .read(sessionProvider.notifier)
            .credentialsFor(widget.device.externalId)
      : Future.value(const []);

  @override
  Widget build(BuildContext context) => SafeArea(
    child: DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.7,
      maxChildSize: 0.95,
      builder: (context, scrollController) => ListView(
        controller: scrollController,
        padding: const EdgeInsets.fromLTRB(16, 4, 16, 16),
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
          Text(
            '${widget.device.lat.toStringAsFixed(5)}, ${widget.device.lng.toStringAsFixed(5)}',
            style: const TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
          ),
          if (widget.isAdmin) ...[
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: _busy ? null : _relocate,
                icon: const Icon(Icons.edit_location_alt_outlined),
                label: const Text('Cambiar ubicación'),
              ),
            ),
          ],
          const Divider(height: 24),
          Text(
            'Detecciones recientes',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          FutureBuilder<List<DeviceDetection>>(
            future: _detections,
            builder: (context, snapshot) => _detectionsList(snapshot),
          ),
          if (widget.isAdmin) ...[
            const Divider(height: 24),
            Text(
              'Credenciales',
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 6),
            FutureBuilder<List<EdgeCredential>>(
              future: _credentials,
              builder: (context, snapshot) => _credentialsList(snapshot),
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
              'Para rotar: emite una nueva, instálala en el nodo con --rotate y después revoca la anterior.',
              style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
            ),
          ],
        ],
      ),
    ),
  );

  Widget _detectionsList(AsyncSnapshot<List<DeviceDetection>> snapshot) {
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
            : 'No fue posible cargar las detecciones.',
        style: const TextStyle(color: Color(0xFFFFB4AB)),
      );
    }
    final items = snapshot.data!;
    if (items.isEmpty) {
      return const Text(
        'Todavía no hay detecciones de esta cámara.',
        style: TextStyle(color: Color(0xFFB7C2BA)),
      );
    }
    return Column(
      children: items
          .take(15)
          .map(
            (detection) => ListTile(
              dense: true,
              contentPadding: EdgeInsets.zero,
              leading: Icon(
                detection.vehicleType == 'motorcycle'
                    ? Icons.two_wheeler
                    : Icons.directions_car_outlined,
                color: const Color(0xFF83DDBA),
              ),
              title: Text(
                '${vehicleLabel(detection.vehicleType)} · ${colorLabel(detection.color)}',
              ),
              subtitle: Text(
                '${formatBogota(detection.observedAt)} · confianza ${(detection.confidence * 100).round()}%',
              ),
            ),
          )
          .toList(),
    );
  }

  Widget _credentialsList(AsyncSnapshot<List<EdgeCredential>> snapshot) {
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
      return const Text('Sin credenciales: el nodo no puede publicar.');
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
                      onPressed: _busy ? null : () => _revoke(credential),
                      child: const Text('Revocar'),
                    )
                  : null,
            ),
          )
          .toList(),
    );
  }

  Future<void> _relocate() async {
    final moved = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => RelocateEdgeScreen(device: widget.device),
      ),
    );
    if (moved == true && mounted) Navigator.of(context).pop();
  }

  Future<void> _issue() async {
    setState(() => _busy = true);
    try {
      final issued = await ref
          .read(sessionProvider.notifier)
          .issueCredential(widget.device.externalId);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => IssuedTokenScreen(
            issued: issued,
            command:
                'bash infra/edges/install-node-token.sh ${widget.device.externalId} --rotate',
          ),
        ),
      );
      setState(() => _credentials = _loadCredentials());
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
      setState(() => _credentials = _loadCredentials());
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

/// Admin: move an existing camera with GPS or the map.
class RelocateEdgeScreen extends ConsumerStatefulWidget {
  const RelocateEdgeScreen({super.key, required this.device});

  final Device device;

  @override
  ConsumerState<RelocateEdgeScreen> createState() => _RelocateEdgeScreenState();
}

class _RelocateEdgeScreenState extends ConsumerState<RelocateEdgeScreen> {
  late LatLng _point = LatLng(widget.device.lat, widget.device.lng);
  bool _saving = false;
  String? _error;

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: Text('Ubicación de ${widget.device.externalId}')),
    body: ListView(
      padding: const EdgeInsets.fromLTRB(16, 8, 16, 32),
      children: [
        const Text(
          'Párate donde está la cámara y usa el GPS, o toca el punto exacto en el mapa.',
          style: TextStyle(color: Color(0xFFB7C2BA)),
        ),
        const SizedBox(height: 12),
        LocationPicker(
          devices: ref.watch(sessionProvider).devices,
          initial: _point,
          onChanged: (point, _) => setState(() => _point = point),
        ),
        if (_error != null) ...[
          const SizedBox(height: 10),
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
                : const Icon(Icons.save_outlined),
            label: const Text('Guardar ubicación'),
          ),
        ),
        const SizedBox(height: 8),
        const Text(
          'Con más de una cámara, después hay que resincronizar las rutas viales (OSRM).',
          style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
        ),
      ],
    ),
  );

  Future<void> _save() async {
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref
          .read(sessionProvider.notifier)
          .relocateEdge(widget.device, _point.latitude, _point.longitude);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            'Ubicación de ${widget.device.externalId} actualizada.',
          ),
        ),
      );
      Navigator.of(context).pop(true);
    } on ApiException catch (error) {
      setState(() => _error = error.message);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }
}
