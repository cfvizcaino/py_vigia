import 'package:flutter/material.dart';

import '../models.dart';
import '../widgets/shared_widgets.dart';

class HistoryScreen extends StatelessWidget {
  const HistoryScreen({super.key, required this.history, required this.onOpen});

  final List<QueryResult> history;
  final ValueChanged<QueryResult> onOpen;

  @override
  Widget build(BuildContext context) {
    if (history.isEmpty) {
      return const Center(
        child: Padding(
          padding: EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.history, size: 42, color: Color(0xFF9AA79F)),
              SizedBox(height: 12),
              Text('Historial vacío', style: TextStyle(fontSize: 18)),
              SizedBox(height: 6),
              Text(
                'Las consultas de esta sesión aparecerán aquí.',
                textAlign: TextAlign.center,
              ),
            ],
          ),
        ),
      );
    }
    return ListView.builder(
      padding: const EdgeInsets.fromLTRB(16, 12, 16, 24),
      itemCount: history.length,
      itemBuilder: (context, index) {
        final result = history[index];
        return Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Material(
            color: const Color(0xFF171D1A),
            borderRadius: BorderRadius.circular(6),
            child: ListTile(
              minTileHeight: 76,
              onTap: () => onOpen(result),
              leading: const Icon(
                Icons.route_outlined,
                color: Color(0xFF83DDBA),
              ),
              title: Text(
                '${vehicleLabel(result.query.input.vehicleType)} · ${result.query.input.color == null ? 'Cualquier color' : colorLabel(result.query.input.color)}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              subtitle: Text(
                '${formatBogota(result.query.createdAt)} · ${result.routes.length} rutas · ${result.candidateDetectionCount} detecciones',
              ),
              trailing: const Icon(Icons.chevron_right),
            ),
          ),
        );
      },
    );
  }
}
