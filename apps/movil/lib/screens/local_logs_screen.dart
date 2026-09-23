import 'package:flutter/material.dart';

class LocalLogsScreen extends StatelessWidget {
  const LocalLogsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Metadatos Locales (Edge Logs)',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: _buildMetricCard(
                      'Uso CPU',
                      '32%',
                      Icons.memory,
                      Colors.blue,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildMetricCard(
                      'Memoria',
                      '1.2 GB',
                      Icons.sd_card_outlined,
                      Colors.orange,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: _buildMetricCard(
                      'Batería',
                      'Cargando',
                      Icons.battery_charging_full,
                      Colors.green,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              const Text(
                'Detecciones Recientes (Sin Video)',
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.bold,
                  color: Color(0xFF0F172A),
                ),
              ),
              const SizedBox(height: 12),
              Expanded(
                child: ListView(
                  children: [
                    DetectionLogTile(
                      type: 'Automóvil',
                      color: 'Gris Plata',
                      direction: 'Norte-Sur',
                      time: '14:32:05',
                      confidence: '92%',
                      icon: Icons.directions_car_filled,
                    ),
                    DetectionLogTile(
                      type: 'Motocicleta',
                      color: 'Negro',
                      direction: 'Sur-Norte',
                      time: '14:28:40',
                      confidence: '88%',
                      icon: Icons.two_wheeler,
                    ),
                    DetectionLogTile(
                      type: 'Automóvil',
                      color: 'Rojo',
                      direction: 'Oriente-Occidente',
                      time: '14:15:12',
                      confidence: '95%',
                      icon: Icons.directions_car_filled,
                    ),
                    DetectionLogTile(
                      type: 'Automóvil',
                      color: 'Blanco',
                      direction: 'Norte-Sur',
                      time: '13:58:01',
                      confidence: '85%',
                      icon: Icons.directions_car_filled,
                    ),
                  ],
                ),
              ),
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: const Color(0xFFF1F5F9),
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFCBD5E1)),
                ),
                child: const Row(
                  children: [
                    Icon(
                      Icons.satellite_alt_outlined,
                      color: Color(0xFF475569),
                    ),
                    SizedBox(width: 10),
                    Expanded(
                      child: Text(
                        'Consultas de la central recibidas hoy: 2 solicitudes respondiendo coincidencias.',
                        style: TextStyle(
                          fontSize: 11,
                          color: Color(0xFF334155),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMetricCard(
    String title,
    String value,
    IconData icon,
    Color color,
  ) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: Colors.grey.shade200),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, color: color, size: 20),
          const SizedBox(height: 8),
          Text(title, style: const TextStyle(fontSize: 10, color: Colors.grey)),
          Text(
            value,
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.bold),
          ),
        ],
      ),
    );
  }
}

class DetectionLogTile extends StatelessWidget {
  final String type;
  final String color;
  final String direction;
  final String time;
  final String confidence;
  final IconData icon;

  const DetectionLogTile({
    super.key,
    required this.type,
    required this.color,
    required this.direction,
    required this.time,
    required this.confidence,
    required this.icon,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 0,
      color: Colors.white,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.grey.shade200),
      ),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: const Color(0xFFEFF6FF),
          child: Icon(icon, color: const Color(0xFF2563EB)),
        ),
        title: Text(
          '$type • Color: $color',
          style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14),
        ),
        subtitle: Text(
          'Dirección: $direction | Hora: $time',
          style: const TextStyle(fontSize: 12, color: Colors.grey),
        ),
        trailing: Container(
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          decoration: BoxDecoration(
            color: const Color(0xFFECFDF5),
            borderRadius: BorderRadius.circular(8),
          ),
          child: Text(
            confidence,
            style: const TextStyle(
              color: Color(0xFF059669),
              fontWeight: FontWeight.bold,
              fontSize: 11,
            ),
          ),
        ),
      ),
    );
  }
}
