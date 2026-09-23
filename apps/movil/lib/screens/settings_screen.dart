import 'package:flutter/material.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _onlyWifi = true;
  bool _onlyCharging = false;
  double _confidenceThreshold = 0.75;
  String _retentionPeriod = '24 Horas';

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'Configuración del Nodo',
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
        backgroundColor: Colors.white,
        elevation: 0,
      ),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            _buildSectionTitle('RED Y ENERGÍA'),
            const SizedBox(height: 8),
            Card(
              elevation: 0,
              color: Colors.white,
              child: Column(
                children: [
                  SwitchListTile(
                    title: const Text('Responder consultas solo con Wi-Fi'),
                    subtitle: const Text('Ahorra consumo de datos móviles'),
                    value: _onlyWifi,
                    onChanged: (value) => setState(() => _onlyWifi = value),
                  ),
                  const Divider(height: 1),
                  SwitchListTile(
                    title: const Text('Procesar solo con cargador conectado'),
                    subtitle: const Text('Protege la vida útil de la batería'),
                    value: _onlyCharging,
                    onChanged: (value) => setState(() => _onlyCharging = value),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            _buildSectionTitle('PARÁMETROS DE VISIÓN POR COMPUTADOR'),
            const SizedBox(height: 8),
            Card(
              elevation: 0,
              color: Colors.white,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        const Text(
                          'Umbral de Confianza Mínimo',
                          style: TextStyle(fontWeight: FontWeight.w500),
                        ),
                        Text(
                          '${(_confidenceThreshold * 100).round()}%',
                          style: const TextStyle(
                            fontWeight: FontWeight.bold,
                            color: Color(0xFF2563EB),
                          ),
                        ),
                      ],
                    ),
                    Slider(
                      value: _confidenceThreshold,
                      min: 0.5,
                      max: 0.95,
                      divisions: 9,
                      onChanged: (value) =>
                          setState(() => _confidenceThreshold = value),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            _buildSectionTitle('PRIVACIDAD Y ALMACENAMIENTO LOCAL'),
            const SizedBox(height: 8),
            Card(
              elevation: 0,
              color: Colors.white,
              child: ListTile(
                title: const Text('Auto-eliminación de metadatos'),
                subtitle: const Text('Borra logs locales automáticamente'),
                trailing: DropdownButton<String>(
                  value: _retentionPeriod,
                  underline: const SizedBox(),
                  items: <String>['12 Horas', '24 Horas', '48 Horas']
                      .map(
                        (value) => DropdownMenuItem<String>(
                          value: value,
                          child: Text(value),
                        ),
                      )
                      .toList(),
                  onChanged: (value) {
                    if (value != null) setState(() => _retentionPeriod = value);
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildSectionTitle(String title) {
    return Text(
      title,
      style: const TextStyle(
        fontSize: 12,
        fontWeight: FontWeight.bold,
        color: Colors.grey,
      ),
    );
  }
}
