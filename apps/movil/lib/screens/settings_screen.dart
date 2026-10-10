import 'package:flutter/material.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({
    super.key,
    required this.baseUrl,
    required this.isDemo,
    required this.onSaveUrl,
    required this.onLogout,
  });

  final String baseUrl;
  final bool isDemo;
  final Future<String?> Function(String value) onSaveUrl;
  final Future<void> Function() onLogout;

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  late final TextEditingController _urlController = TextEditingController(
    text: widget.baseUrl,
  );
  bool _saving = false;

  @override
  void didUpdateWidget(covariant SettingsScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.baseUrl != widget.baseUrl) {
      _urlController.text = widget.baseUrl;
    }
  }

  @override
  void dispose() {
    _urlController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => ListView(
    padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
    children: [
      Text('Servidor central', style: Theme.of(context).textTheme.titleLarge),
      const SizedBox(height: 8),
      const Text(
        'La dirección se guarda en este dispositivo. El token de sesión se almacena únicamente en almacenamiento seguro.',
        style: TextStyle(color: Color(0xFFB7C2BA)),
      ),
      const SizedBox(height: 18),
      TextField(
        controller: _urlController,
        keyboardType: TextInputType.url,
        autocorrect: false,
        decoration: const InputDecoration(
          labelText: 'URL base del backend',
          hintText: 'https://api.vigia.example',
          prefixIcon: Icon(Icons.link),
        ),
      ),
      const SizedBox(height: 10),
      const Text(
        'HTTP solo está permitido para localhost y emuladores de desarrollo. Otros servidores deben usar HTTPS.',
        style: TextStyle(color: Color(0xFFFFD18A), fontSize: 12),
      ),
      const SizedBox(height: 14),
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
          label: const Text('Guardar URL'),
        ),
      ),
      if (widget.isDemo) ...[
        const SizedBox(height: 20),
        Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            color: const Color(0xFF302517),
            borderRadius: BorderRadius.circular(6),
          ),
          child: const Text(
            'Estás en modo demostración. Las consultas no se envían al backend.',
            style: TextStyle(color: Color(0xFFFFD18A)),
          ),
        ),
      ],
      const SizedBox(height: 28),
      const Divider(),
      const ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(Icons.lock_outline),
        title: Text('Sesión protegida'),
        subtitle: Text(
          'El token no se guarda en preferencias ni en archivos de registro.',
        ),
      ),
      const ListTile(
        contentPadding: EdgeInsets.zero,
        leading: Icon(Icons.schedule),
        title: Text('Zona horaria de operación'),
        subtitle: Text('America/Bogota (UTC−5)'),
      ),
      const SizedBox(height: 18),
      SizedBox(
        height: 52,
        child: OutlinedButton.icon(
          onPressed: widget.onLogout,
          icon: const Icon(Icons.logout),
          label: const Text('Cerrar sesión'),
        ),
      ),
    ],
  );

  Future<void> _save() async {
    setState(() => _saving = true);
    final error = await widget.onSaveUrl(_urlController.text);
    if (!mounted) return;
    setState(() => _saving = false);
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(error ?? 'URL del backend guardada.'),
        backgroundColor: error == null ? null : const Color(0xFF7A2925),
      ),
    );
  }
}
