import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../api_client.dart';
import '../models.dart';
import '../session.dart';
import '../widgets/map_panel.dart';
import '../widgets/shared_widgets.dart';

class ResultsScreen extends ConsumerWidget {
  const ResultsScreen({super.key, required this.result, required this.isDemo});

  final QueryResult? result;
  final bool isDemo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final queryResult = result;
    if (queryResult == null) {
      return const _EmptyResults();
    }
    final mapDevices = queryResult.nearbyDevices
        .map(
          (device) => Device(
            id: device.id,
            externalId: device.externalId,
            name: device.name,
            kind: 'physical',
            status: 'offline',
            lat: device.lat,
            lng: device.lng,
          ),
        )
        .toList(growable: false);
    final allHaveGeometry = queryResult.routes.every(
      (route) => route.roadPoints.length >= 2,
    );
    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      children: [
        if (isDemo) const _DemoNotice(),
        Row(
          children: [
            Expanded(
              child: Text(
                '${queryResult.routes.length} rutas candidatas',
                style: Theme.of(context).textTheme.titleLarge,
              ),
            ),
            IconButton(
              tooltip: isDemo
                  ? 'Exportación auditada no disponible en demo'
                  : 'Exportar y compartir JSON auditado',
              onPressed: isDemo
                  ? null
                  : () => _export(context, ref, queryResult),
              icon: const Icon(Icons.ios_share),
            ),
          ],
        ),
        const SizedBox(height: 6),
        Text(
          '${queryResult.candidateDetectionCount} detecciones candidatas · consulta ${queryResult.query.id}',
          style: const TextStyle(color: Color(0xFFB7C2BA)),
        ),
        const SizedBox(height: 14),
        if (queryResult.routes.isNotEmpty) ...[
          MapPanel(
            devices: mapDevices,
            routes: queryResult.routes,
            height: 310,
          ),
          const SizedBox(height: 8),
          Text(
            allHaveGeometry ? 'Geometría vial entregada por el servidor.' : 'Estimación directa: conexión entre cámaras; no representa una ruta vial.',
            style: const TextStyle(color: Color(0xFFFFD18A), fontSize: 12),
          ),
          const SizedBox(height: 16),
          ...queryResult.routes.map(
            (route) => _RouteDetails(
              route: route,
              index: queryResult.routes.indexOf(route),
            ),
          ),
        ] else
          const _EmptyResults(hasQuery: true),
      ],
    );
  }

  Future<void> _export(
    BuildContext context,
    WidgetRef ref,
    QueryResult result,
  ) async {
    try {
      final json = await ref.read(sessionProvider.notifier).exportJson(result);
      await SharePlus.instance.share(
        ShareParams(
          text: json,
          subject: 'VIGÍA · Exportación auditada ${result.query.id}',
        ),
      );
    } on ApiException catch (error) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(error.message)));
      }
    } catch (_) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('No fue posible compartir la exportación.'),
          ),
        );
      }
    }
  }
}

class _RouteDetails extends StatelessWidget {
  const _RouteDetails({required this.route, required this.index});

  final CandidateRoute route;
  final int index;

  static const _colors = [
    Color(0xFF44C7A1),
    Color(0xFFFFC66D),
    Color(0xFF84B7FF),
    Color(0xFFF28B82),
  ];

  @override
  Widget build(BuildContext context) {
    final segments = route.explanation['segments'];
    final weights = route.explanation['weights'];
    final directEstimate = route.roadPoints.length < 2;
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      decoration: BoxDecoration(
        color: const Color(0xFF171D1A),
        border: Border.all(color: const Color(0xFF303A34)),
        borderRadius: BorderRadius.circular(6),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 12,
                  height: 12,
                  decoration: BoxDecoration(
                    color: _colors[index % _colors.length],
                    shape: BoxShape.circle,
                  ),
                ),
                const SizedBox(width: 9),
                Expanded(
                  child: Text(
                    'Ruta candidata ${route.rank}',
                    style: Theme.of(context).textTheme.titleMedium
                        ?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ),
                Text(
                  '${(route.confidence * 100).round()} pts',
                  style: TextStyle(
                    color: _colors[index % _colors.length],
                    fontWeight: FontWeight.w800,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text(
              '${vehicleLabel(route.vehicleType)} · ${colorLabel(route.color)} · ${route.cameraIds.join(' → ')}',
              style: const TextStyle(color: Color(0xFFB7C2BA)),
            ),
            if (route.hasDistantGaps) ...[
              const SizedBox(height: 8),
              const Text(
                'Hay saltos distantes entre observaciones.',
                style: TextStyle(color: Color(0xFFFFD18A)),
              ),
            ],
            if (directEstimate) ...[
              const SizedBox(height: 8),
              const Text(
                'Estimación directa',
                style: TextStyle(
                  color: Color(0xFFFFD18A),
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
            const Divider(height: 24),
            Text(
              'Explicación del puntaje',
              style: Theme.of(context).textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 5),
            const Text(
              'Es un puntaje de ranking (0–1), no una probabilidad de identificación.',
              style: TextStyle(color: Color(0xFFB7C2BA), fontSize: 12),
            ),
            if (weights is Map && weights.isNotEmpty) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 4,
                children: weights.entries.map((entry) {
                  final label = switch (entry.key.toString()) {
                    'detection' => 'Detección',
                    'time' => 'Tiempo',
                    'appearance' => 'Apariencia',
                    'road' => 'Vía',
                    _ => entry.key.toString(),
                  };
                  final value = (entry.value as num).toDouble();
                  return Text('$label ${(value * 100).round()}%');
                }).toList(),
              ),
            ],
            if (segments is List && segments.isNotEmpty) ...[
              const SizedBox(height: 6),
              ...segments.whereType<Map>().map(_segmentText),
            ],
            const Divider(height: 24),
            Text(
              'Detecciones · hora de Colombia',
              style: Theme.of(context).textTheme.titleSmall
                  ?.copyWith(fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            ...route.detections.map(
              (detection) => _TimelineItem(detection: detection),
            ),
          ],
        ),
      ),
    );
  }

  Widget _segmentText(Map segment) {
    final distance = (segment['distance_m'] as num?)?.round();
    final seconds = (segment['observed_seconds'] as num?)?.round();
    final source = segment['source']?.toString();
    return Padding(
      padding: const EdgeInsets.only(top: 4),
      child: Text(
        '${segment['from_camera'] ?? '?'} → ${segment['to_camera'] ?? '?'} · ${distance ?? '—'} m · ${seconds ?? '—'} s observados · ${source ?? 'sin dato'}',
        style: const TextStyle(color: Color(0xFFB7C2BA), fontSize: 12),
      ),
    );
  }
}

class _TimelineItem extends StatelessWidget {
  const _TimelineItem({required this.detection});

  final RouteDetection detection;

  @override
  Widget build(BuildContext context) => IntrinsicHeight(
    child: Row(
      children: [
        SizedBox(
          width: 24,
          child: Column(
            children: [
              const Icon(Icons.circle, size: 9, color: Color(0xFF69D4A8)),
              Expanded(
                child: Container(width: 2, color: const Color(0xFF3D584B)),
              ),
            ],
          ),
        ),
        const SizedBox(width: 5),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  detection.cameraId,
                  style: const TextStyle(fontWeight: FontWeight.w700),
                ),
                Text(
                  '${formatBogota(detection.observedAt)} · ${colorLabel(detection.color)} · confianza de detección ${(detection.confidence * 100).round()}%',
                  style: const TextStyle(
                    color: Color(0xFFB7C2BA),
                    fontSize: 12,
                  ),
                ),
              ],
            ),
          ),
        ),
      ],
    ),
  );
}

class _EmptyResults extends StatelessWidget {
  const _EmptyResults({this.hasQuery = false});

  final bool hasQuery;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(32),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            hasQuery ? Icons.route_outlined : Icons.manage_search,
            size: 44,
            color: const Color(0xFF9AA79F),
          ),
          const SizedBox(height: 12),
          Text(
            hasQuery ? 'Sin rutas candidatas' : 'Aún no hay resultados',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 6),
          Text(
            hasQuery
                ? 'No se encontraron suficientes observaciones para conectar.'
                : 'Ejecuta una consulta para revisar rutas y detecciones.',
            textAlign: TextAlign.center,
          ),
        ],
      ),
    ),
  );
}

class _DemoNotice extends StatelessWidget {
  const _DemoNotice();

  @override
  Widget build(BuildContext context) => Container(
    margin: const EdgeInsets.only(bottom: 14),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFF302517),
      borderRadius: BorderRadius.circular(6),
    ),
    child: const Text(
      'DEMOSTRACIÓN · Resultados locales, no auditados por el servidor.',
      style: TextStyle(color: Color(0xFFFFD18A)),
    ),
  );
}
