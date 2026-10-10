import 'package:flutter/material.dart';

class SafetyBanner extends StatelessWidget {
  const SafetyBanner({super.key});

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    padding: const EdgeInsets.fromLTRB(16, 12, 16, 12),
    color: const Color(0xFF302517),
    child: const Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(Icons.info_outline, color: Color(0xFFFFC66D), size: 20),
        SizedBox(width: 10),
        Expanded(
          child: Text(
            'Trayectorias estimadas; no constituyen una identificación confirmada',
            style: TextStyle(color: Color(0xFFFFE1B0), fontSize: 13),
          ),
        ),
      ],
    ),
  );
}

class StatusTag extends StatelessWidget {
  const StatusTag({super.key, required this.status});

  final String status;

  @override
  Widget build(BuildContext context) {
    final (label, color) = switch (status) {
      'online' => ('En línea', const Color(0xFF69D4A8)),
      'simulated' => ('Simulada', const Color(0xFFFFC66D)),
      _ => ('Sin conexión', const Color(0xFFF28B82)),
    };
    return DecoratedBox(
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(4),
      ),
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 5),
        child: Text(
          label,
          style: TextStyle(
            color: color,
            fontSize: 12,
            fontWeight: FontWeight.w600,
          ),
        ),
      ),
    );
  }
}

String vehicleLabel(String? type) => switch (type) {
  'motorcycle' => 'Motocicleta',
  'car' => 'Automóvil',
  _ => 'Cualquier vehículo',
};

/// Same vocabulary as the web console (apps/web/src/lib/monitoring.ts).
const colorLabels = {
  'white': 'Blanco',
  'black': 'Negro',
  'gray': 'Gris',
  'silver': 'Plateado',
  'red': 'Rojo',
  'blue': 'Azul',
  'green': 'Verde',
  'yellow': 'Amarillo',
};

String colorLabel(String? color) => switch (color) {
  null || '' => 'Sin especificar',
  _ => colorLabels[color] ?? color,
};

DateTime bogotaTime(DateTime value) =>
    value.toUtc().subtract(const Duration(hours: 5));

String formatBogota(DateTime value) {
  final local = bogotaTime(value);
  final date =
      '${local.year.toString().padLeft(4, '0')}-'
      '${local.month.toString().padLeft(2, '0')}-'
      '${local.day.toString().padLeft(2, '0')}';
  final time =
      '${local.hour.toString().padLeft(2, '0')}:'
      '${local.minute.toString().padLeft(2, '0')}';
  return '$date $time';
}

DateTime bogotaInput(DateTime date, TimeOfDay time) =>
    DateTime.utc(date.year, date.month, date.day, time.hour + 5, time.minute);
