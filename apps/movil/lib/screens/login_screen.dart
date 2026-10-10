import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../session.dart';
import '../widgets/shared_widgets.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _emailController = TextEditingController();
  final _passwordController = TextEditingController();
  bool _obscurePassword = true;

  @override
  void dispose() {
    _emailController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(sessionProvider);
    final controller = ref.read(sessionProvider.notifier);
    return Scaffold(
      appBar: AppBar(
        actions: [
          IconButton(
            tooltip: 'Configurar URL del servidor',
            onPressed: () => _editApiUrl(context, state.baseUrl),
            icon: const Icon(Icons.link),
          ),
        ],
      ),
      body: Column(
        children: [
          Expanded(
            child: Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 440),
                child: SingleChildScrollView(
                  padding: const EdgeInsets.fromLTRB(24, 8, 24, 32),
                  child: Form(
                    key: _formKey,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        const _VigiaMark(),
                        const SizedBox(height: 28),
                        Text(
                          'Consola del operador',
                          style: Theme.of(context).textTheme.headlineSmall
                              ?.copyWith(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Accede a cámaras y consulta trayectorias estimadas.',
                          style: Theme.of(context).textTheme.bodyLarge
                              ?.copyWith(color: const Color(0xFFB7C2BA)),
                        ),
                        const SizedBox(height: 28),
                        TextFormField(
                          controller: _emailController,
                          keyboardType: TextInputType.emailAddress,
                          textInputAction: TextInputAction.next,
                          autofillHints: const [AutofillHints.username],
                          decoration: const InputDecoration(
                            labelText: 'Correo electrónico',
                            prefixIcon: Icon(Icons.alternate_email),
                          ),
                          validator: (value) {
                            final email = value?.trim() ?? '';
                            if (!RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')
                                .hasMatch(email)) {
                              return 'Ingresa un correo válido.';
                            }
                            return null;
                          },
                        ),
                        const SizedBox(height: 14),
                        TextFormField(
                          controller: _passwordController,
                          obscureText: _obscurePassword,
                          textInputAction: TextInputAction.done,
                          autofillHints: const [AutofillHints.password],
                          onFieldSubmitted: (_) => _submit(),
                          decoration: InputDecoration(
                            labelText: 'Contraseña',
                            prefixIcon: const Icon(Icons.lock_outline),
                            suffixIcon: IconButton(
                              tooltip: _obscurePassword
                                  ? 'Mostrar contraseña'
                                  : 'Ocultar contraseña',
                              onPressed: () => setState(
                                () => _obscurePassword = !_obscurePassword,
                              ),
                              icon: Icon(
                                _obscurePassword
                                    ? Icons.visibility_outlined
                                    : Icons.visibility_off_outlined,
                              ),
                            ),
                          ),
                          validator: (value) => (value ?? '').isEmpty
                              ? 'Ingresa tu contraseña.'
                              : null,
                        ),
                        if (state.error != null) ...[
                          const SizedBox(height: 14),
                          _InlineError(message: state.error!),
                        ],
                        const SizedBox(height: 20),
                        SizedBox(
                          height: 52,
                          child: FilledButton.icon(
                            onPressed: state.busy ? null : _submit,
                            icon: state.busy
                                ? const SizedBox.square(
                                    dimension: 18,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                    ),
                                  )
                                : const Icon(Icons.login),
                            label: const Text('Iniciar sesión'),
                          ),
                        ),
                        const SizedBox(height: 12),
                        SizedBox(
                          height: 52,
                          child: OutlinedButton.icon(
                            onPressed: controller.exploreDemo,
                            icon: const Icon(Icons.explore_outlined),
                            label: const Text('Explorar demo'),
                          ),
                        ),
                        const SizedBox(height: 22),
                        Text(
                          state.baseUrl,
                          textAlign: TextAlign.center,
                          style: Theme.of(context).textTheme.labelMedium
                              ?.copyWith(color: const Color(0xFF94A39A)),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ),
          ),
          const SafetyBanner(),
        ],
      ),
    );
  }

  void _submit() {
    if (_formKey.currentState?.validate() ?? false) {
      ref
          .read(sessionProvider.notifier)
          .login(_emailController.text, _passwordController.text);
    }
  }

  Future<void> _editApiUrl(BuildContext context, String baseUrl) async {
    final value = await showDialog<String>(
      context: context,
      builder: (context) => _ApiUrlDialog(initialValue: baseUrl),
    );
    if (value == null || !context.mounted) return;
    final error = await ref.read(sessionProvider.notifier).saveApiUrl(value);
    if (error != null && context.mounted) {
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(error)));
    }
  }
}

class _ApiUrlDialog extends StatefulWidget {
  const _ApiUrlDialog({required this.initialValue});

  final String initialValue;

  @override
  State<_ApiUrlDialog> createState() => _ApiUrlDialogState();
}

class _ApiUrlDialogState extends State<_ApiUrlDialog> {
  late final _controller = TextEditingController(text: widget.initialValue);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('URL del backend'),
    content: TextField(
      controller: _controller,
      keyboardType: TextInputType.url,
      autocorrect: false,
      decoration: const InputDecoration(
        labelText: 'Dirección del servidor',
        hintText: 'https://servidor.vigia',
        helperText: 'Emulador Android: http://10.0.2.2:8000',
        helperMaxLines: 2,
      ),
    ),
    actions: [
      TextButton(
        onPressed: () => Navigator.pop(context),
        child: const Text('Cancelar'),
      ),
      FilledButton(
        onPressed: () => Navigator.pop(context, _controller.text),
        child: const Text('Guardar'),
      ),
    ],
  );
}

class _VigiaMark extends StatelessWidget {
  const _VigiaMark();

  @override
  Widget build(BuildContext context) => Row(
    children: [
      Container(
        width: 54,
        height: 54,
        decoration: BoxDecoration(
          color: const Color(0xFF234D40),
          borderRadius: BorderRadius.circular(8),
        ),
        child: const Icon(Icons.radar, size: 31, color: Color(0xFF7DE0BD)),
      ),
      const SizedBox(width: 14),
      Text(
        'VIGÍA',
        style: Theme.of(context).textTheme.headlineMedium
            ?.copyWith(fontWeight: FontWeight.w900, letterSpacing: 0),
      ),
    ],
  );
}

class _InlineError extends StatelessWidget {
  const _InlineError({required this.message});

  final String message;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: const Color(0xFF3A2221),
      borderRadius: BorderRadius.circular(6),
    ),
    child: Text(message, style: const TextStyle(color: Color(0xFFFFB4AB))),
  );
}
