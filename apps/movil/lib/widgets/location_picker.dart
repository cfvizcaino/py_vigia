import 'package:flutter/material.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

import '../models.dart';
import 'map_panel.dart';

/// Picks where a camera stands: the phone's GPS (standing at the spot) or a tap
/// on the map. Reports the point and, for GPS, its accuracy in meters.
class LocationPicker extends StatefulWidget {
  const LocationPicker({
    super.key,
    required this.devices,
    required this.onChanged,
    this.initial,
  });

  final List<Device> devices;
  final LatLng? initial;
  final void Function(LatLng point, double? accuracyM) onChanged;

  @override
  State<LocationPicker> createState() => _LocationPickerState();
}

class _LocationPickerState extends State<LocationPicker> {
  late LatLng? _point = widget.initial;
  double? _accuracyM;
  bool _locating = false;
  String? _error;

  @override
  Widget build(BuildContext context) {
    final devices = widget.devices;
    final fallback = devices.isNotEmpty
        ? LatLng(devices.first.lat, devices.first.lng)
        : const LatLng(11.0131, -74.8172);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
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
          selectedPoint: _point ?? fallback,
          height: 240,
          onPointSelected: (point) {
            setState(() {
              _point = point;
              _accuracyM = null;
            });
            widget.onChanged(point, null);
          },
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
        if (_error != null) ...[
          const SizedBox(height: 6),
          Text(_error!, style: const TextStyle(color: Color(0xFFFFB4AB))),
        ],
      ],
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
      final point = LatLng(position.latitude, position.longitude);
      setState(() {
        _point = point;
        _accuracyM = position.accuracy;
      });
      widget.onChanged(point, position.accuracy);
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
}

class _LocationProblem implements Exception {
  const _LocationProblem(this.message);
  final String message;
}
