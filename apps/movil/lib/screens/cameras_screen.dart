import 'package:flutter/material.dart';
import 'package:latlong2/latlong.dart';

import '../models.dart';
import '../widgets/map_panel.dart';
import '../widgets/shared_widgets.dart';

class CamerasScreen extends StatefulWidget {
  const CamerasScreen({super.key, required this.devices});

  final List<Device> devices;

  @override
  State<CamerasScreen> createState() => _CamerasScreenState();
}

class _CamerasScreenState extends State<CamerasScreen> {
  bool _showMap = true;

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
    children: [
      Row(
        children: [
          Expanded(
            child: Text(
              '${widget.devices.length} cámaras registradas',
              style: Theme.of(context).textTheme.titleMedium,
            ),
          ),
          SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: true, icon: Icon(Icons.map_outlined)),
              ButtonSegment(value: false, icon: Icon(Icons.view_list)),
            ],
            selected: {_showMap},
            onSelectionChanged: (values) =>
                setState(() => _showMap = values.first),
          ),
        ],
      ),
      const SizedBox(height: 14),
      if (_showMap)
        MapPanel(devices: widget.devices, height: 330)
      else if (widget.devices.isEmpty)
        const _EmptyState(
          icon: Icons.videocam_off_outlined,
          title: 'No hay cámaras',
          detail: 'El servidor no tiene cámaras registradas.',
        )
      else
        ...widget.devices.map((device) => _CameraTile(device: device)),
      if (_showMap && widget.devices.isNotEmpty) ...[
        const SizedBox(height: 14),
        ...widget.devices.map((device) => _CameraTile(device: device)),
      ],
      const SizedBox(height: 14),
      const Text(
        'Los mapas usan teselas de OpenStreetMap.',
        style: TextStyle(color: Color(0xFF9AA79F), fontSize: 12),
      ),
    ],
  );
}

class _CameraTile extends StatelessWidget {
  const _CameraTile({required this.device});

  final Device device;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.only(bottom: 8),
    child: Material(
      color: const Color(0xFF171D1A),
      borderRadius: BorderRadius.circular(6),
      child: ListTile(
        minTileHeight: 68,
        leading: Container(
          width: 42,
          height: 42,
          decoration: BoxDecoration(
            color: const Color(0xFF26352D),
            borderRadius: BorderRadius.circular(6),
          ),
          child: const Icon(Icons.videocam_outlined, color: Color(0xFF8FE1C4)),
        ),
        title: Text(
          device.externalId,
          style: const TextStyle(fontWeight: FontWeight.w700),
        ),
        subtitle: Text(
          '${device.name} · ${device.lat.toStringAsFixed(4)}, ${device.lng.toStringAsFixed(4)}',
        ),
        trailing: StatusTag(status: device.status),
      ),
    ),
  );
}

class QueryScreen extends StatefulWidget {
  const QueryScreen({
    super.key,
    required this.devices,
    required this.busy,
    required this.isDemo,
    required this.onSearch,
    this.error,
  });

  final List<Device> devices;
  final bool busy;
  final bool isDemo;
  final String? error;
  final ValueChanged<QueryInput> onSearch;

  @override
  State<QueryScreen> createState() => _QueryScreenState();
}

class _QueryScreenState extends State<QueryScreen> {
  final _formKey = GlobalKey<FormState>();
  final _latController = TextEditingController(text: '11.0131');
  final _lngController = TextEditingController(text: '-74.8172');
  String _selectedCamera = '';
  String? _vehicle = 'car';
  String? _color = 'white';
  int _radiusM = 2000;
  late DateTime _from;
  late DateTime _to;

  @override
  void initState() {
    super.initState();
    if (widget.devices.isNotEmpty) {
      _latController.text = widget.devices.first.lat.toString();
      _lngController.text = widget.devices.first.lng.toString();
      _selectedCamera = widget.devices.first.id;
    }
    if (widget.isDemo) {
      _from = DateTime.parse('2026-08-25T14:20:00Z');
      _to = DateTime.parse('2026-08-25T15:30:00Z');
    } else {
      _to = DateTime.now().toUtc();
      _from = _to.subtract(const Duration(hours: 1));
    }
  }

  @override
  void dispose() {
    _latController.dispose();
    _lngController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final lat = double.tryParse(_latController.text) ?? 11.0131;
    final lng = double.tryParse(_lngController.text) ?? -74.8172;
    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
        children: [
          if (widget.isDemo) const _DemoNotice(),
          Text(
            'Punto de búsqueda',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _selectedCamera,
            decoration: const InputDecoration(
              labelText: 'Cámara de referencia',
              prefixIcon: Icon(Icons.videocam_outlined),
            ),
            items: [
              const DropdownMenuItem(
                value: '',
                child: Text('Punto manual en el mapa'),
              ),
              ...widget.devices.map(
                (device) => DropdownMenuItem(
                  value: device.id,
                  child: Text('${device.externalId} · ${device.name}'),
                ),
              ),
            ],
            onChanged: (value) {
              setState(() {
                _selectedCamera = value ?? '';
                final match = widget.devices.where(
                  (device) => device.id == value,
                );
                if (match.isNotEmpty) {
                  _latController.text = match.first.lat.toString();
                  _lngController.text = match.first.lng.toString();
                }
              });
            },
          ),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                child: _coordinateField(_latController, 'Latitud', -90, 90),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: _coordinateField(_lngController, 'Longitud', -180, 180),
              ),
            ],
          ),
          const SizedBox(height: 10),
          MapPanel(
            devices: widget.devices,
            selectedPoint: LatLng(lat, lng),
            height: 210,
            onPointSelected: (point) => setState(() {
              _selectedCamera = '';
              _latController.text = point.latitude.toStringAsFixed(6);
              _lngController.text = point.longitude.toStringAsFixed(6);
            }),
          ),
          const SizedBox(height: 22),
          Text(
            'Vehículo y apariencia',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String>(
            initialValue: _vehicle,
            decoration: const InputDecoration(labelText: 'Tipo de vehículo'),
            items: const [
              DropdownMenuItem(value: 'car', child: Text('Automóvil')),
              DropdownMenuItem(value: 'motorcycle', child: Text('Motocicleta')),
            ],
            onChanged: (value) => setState(() => _vehicle = value),
          ),
          const SizedBox(height: 10),
          DropdownButtonFormField<String?>(
            initialValue: _color,
            decoration: const InputDecoration(labelText: 'Color'),
            items: const [
              DropdownMenuItem<String?>(
                value: null,
                child: Text('Cualquier color'),
              ),
              DropdownMenuItem(value: 'white', child: Text('Blanco')),
              DropdownMenuItem(value: 'black', child: Text('Negro')),
              DropdownMenuItem(value: 'gray', child: Text('Gris / plata')),
              DropdownMenuItem(value: 'red', child: Text('Rojo')),
              DropdownMenuItem(value: 'blue', child: Text('Azul')),
              DropdownMenuItem(value: 'green', child: Text('Verde')),
            ],
            onChanged: (value) => setState(() => _color = value),
          ),
          const SizedBox(height: 22),
          Text(
            'Ventana temporal',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 4),
          const Text(
            'Hora de Colombia (UTC−5)',
            style: TextStyle(color: Color(0xFF9AA79F)),
          ),
          _DateTimeRow(
            label: 'Desde',
            value: _from,
            onChanged: (value) => setState(() => _from = value),
          ),
          _DateTimeRow(
            label: 'Hasta',
            value: _to,
            onChanged: (value) => setState(() => _to = value),
          ),
          const SizedBox(height: 18),
          Row(
            children: [
              Expanded(
                child: Text(
                  'Radio de búsqueda',
                  style: Theme.of(context).textTheme.titleMedium,
                ),
              ),
              Text(
                '${(_radiusM / 1000).toStringAsFixed(_radiusM < 1000 ? 0 : 1)} km',
              ),
            ],
          ),
          Slider(
            value: _radiusM.toDouble(),
            min: 100,
            max: 5000,
            divisions: 49,
            label: '$_radiusM m',
            onChanged: (value) => setState(() => _radiusM = value.round()),
          ),
          if (widget.error != null) ...[
            const SizedBox(height: 8),
            Text(
              widget.error!,
              style: const TextStyle(color: Color(0xFFFFB4AB)),
            ),
          ],
          const SizedBox(height: 14),
          SizedBox(
            height: 52,
            child: FilledButton.icon(
              onPressed: widget.busy ? null : _submit,
              icon: widget.busy
                  ? const SizedBox.square(
                      dimension: 18,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.search),
              label: const Text('Consultar trayectorias'),
            ),
          ),
        ],
      ),
    );
  }

  Widget _coordinateField(
    TextEditingController controller,
    String label,
    double minimum,
    double maximum,
  ) => TextFormField(
    controller: controller,
    keyboardType: const TextInputType.numberWithOptions(
      decimal: true,
      signed: true,
    ),
    decoration: InputDecoration(labelText: label),
    validator: (value) {
      final number = double.tryParse(value ?? '');
      if (number == null || number < minimum || number > maximum) {
        return 'Coordenada no válida.';
      }
      return null;
    },
  );

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;
    if (!_to.isAfter(_from)) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('La hora final debe ser posterior a la inicial.'),
        ),
      );
      return;
    }
    widget.onSearch(
      QueryInput(
        lat: double.parse(_latController.text),
        lng: double.parse(_lngController.text),
        radiusM: _radiusM,
        timeFrom: _from,
        timeTo: _to,
        vehicleType: _vehicle,
        color: _color,
      ),
    );
  }
}

class _DateTimeRow extends StatelessWidget {
  const _DateTimeRow({
    required this.label,
    required this.value,
    required this.onChanged,
  });

  final String label;
  final DateTime value;
  final ValueChanged<DateTime> onChanged;

  @override
  Widget build(BuildContext context) {
    final local = bogotaTime(value);
    return ListTile(
      contentPadding: EdgeInsets.zero,
      title: Text(label),
      subtitle: Text(formatBogota(value)),
      trailing: Wrap(
        spacing: 4,
        children: [
          IconButton(
            tooltip: 'Elegir fecha de $label',
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            onPressed: () async {
              final date = await showDatePicker(
                context: context,
                initialDate: local,
                firstDate: DateTime(2020),
                lastDate: DateTime(2035),
              );
              if (date != null) {
                onChanged(
                  DateTime.utc(
                    date.year,
                    date.month,
                    date.day,
                    local.hour + 5,
                    local.minute,
                  ),
                );
              }
            },
            icon: const Icon(Icons.calendar_month_outlined),
          ),
          IconButton(
            tooltip: 'Elegir hora de $label',
            constraints: const BoxConstraints(minWidth: 48, minHeight: 48),
            onPressed: () async {
              final time = await showTimePicker(
                context: context,
                initialTime: TimeOfDay.fromDateTime(local),
              );
              if (time != null) {
                onChanged(
                  DateTime.utc(
                    local.year,
                    local.month,
                    local.day,
                    time.hour + 5,
                    time.minute,
                  ),
                );
              }
            },
            icon: const Icon(Icons.schedule),
          ),
        ],
      ),
    );
  }
}

class _DemoNotice extends StatelessWidget {
  const _DemoNotice();

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 16),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFF302517),
      borderRadius: BorderRadius.circular(6),
    ),
    child: const Text(
      'DEMOSTRACIÓN · Datos de ejemplo locales; no se envían al servidor.',
      style: TextStyle(color: Color(0xFFFFD18A)),
    ),
  );
}

class _EmptyState extends StatelessWidget {
  const _EmptyState({
    required this.icon,
    required this.title,
    required this.detail,
  });

  final IconData icon;
  final String title;
  final String detail;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 56),
    child: Column(
      children: [
        Icon(icon, size: 42, color: const Color(0xFF9AA79F)),
        const SizedBox(height: 12),
        Text(title, style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 6),
        Text(detail, textAlign: TextAlign.center),
      ],
    ),
  );
}
