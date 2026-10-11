import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

import '../models.dart';

class MapPanel extends StatelessWidget {
  const MapPanel({
    super.key,
    required this.devices,
    this.routes = const [],
    this.selectedPoint,
    this.onPointSelected,
    this.height = 300,
  });

  final List<Device> devices;
  final List<CandidateRoute> routes;
  final LatLng? selectedPoint;
  final ValueChanged<LatLng>? onPointSelected;
  final double height;

  static const _routeColors = [
    Color(0xFF44C7A1),
    Color(0xFFFFC66D),
    Color(0xFF84B7FF),
    Color(0xFFF28B82),
  ];

  @override
  Widget build(BuildContext context) {
    final center =
        selectedPoint ??
        (devices.isNotEmpty
            ? LatLng(devices.first.lat, devices.first.lng)
            : const LatLng(11.0131, -74.8172));
    final markers = <Marker>[
      ...devices.map(
        (device) => Marker(
          point: LatLng(device.lat, device.lng),
          width: 48,
          height: 48,
          child: Tooltip(
            message: '${device.externalId}: ${device.name}',
            child: Icon(
              Icons.videocam,
              size: 30,
              color: device.status == 'online'
                  ? const Color(0xFF69D4A8)
                  : const Color(0xFFFFC66D),
            ),
          ),
        ),
      ),
      if (selectedPoint != null)
        Marker(
          point: selectedPoint!,
          width: 48,
          height: 48,
          child: const Icon(
            Icons.location_on,
            color: Color(0xFFF28B82),
            size: 40,
          ),
        ),
    ];
    final polylines = <Polyline>[];
    for (var index = 0; index < routes.length; index++) {
      final route = routes[index];
      final roadPoints = route.roadPoints;
      final points = roadPoints.length >= 2
          ? roadPoints.map((point) => LatLng(point.lat, point.lng)).toList()
          : route.cameraIds
                .map((id) => devices.where((device) => device.externalId == id))
                .where((matches) => matches.isNotEmpty)
                .map((matches) => LatLng(matches.first.lat, matches.first.lng))
                .toList();
      if (points.length >= 2) {
        polylines.add(
          Polyline(
            points: points,
            color: _routeColors[index % _routeColors.length],
            strokeWidth: index == 0 ? 5 : 3,
          ),
        );
      }
    }

    return SizedBox(
      height: height,
      child: ClipRRect(
        borderRadius: BorderRadius.circular(6),
        child: FlutterMap(
          options: MapOptions(
            initialCenter: center,
            initialZoom: 14,
            minZoom: 3,
            maxZoom: 19,
            onTap: onPointSelected == null
                ? null
                : (_, point) => onPointSelected!(point),
          ),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.example.movil',
            ),
            // Painted last means on top: keep the best-ranked route visible.
            if (polylines.isNotEmpty)
              PolylineLayer(polylines: polylines.reversed.toList()),
            if (markers.isNotEmpty) MarkerLayer(markers: markers),
            const RichAttributionWidget(
              attributions: [
                TextSourceAttribution('© OpenStreetMap contributors'),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
