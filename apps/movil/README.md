# VIGÍA móvil

Consola móvil del operador en Flutter: inicio de sesión, cámaras en mapa, consultas de trayectorias, resultados con geometría vial y explicación del puntaje, historial de la sesión, exportación auditada y ajustes. **Explorar demo** usa datos locales de ejemplo, siempre se identifica como demostración y nunca se activa como respaldo de una conexión fallida.

## Requisitos

- Flutter **3.44 o superior** (validado con 3.47.7). En el equipo del proyecto está en `~/development/flutter`:

  ```bash
  export PATH="$HOME/development/flutter/bin:$PATH"
  ```

- Para Android: Android Studio o Android SDK con un emulador, o un teléfono con depuración USB.
- El backend en marcha. Con Docker Compose queda en `127.0.0.1:8000` (piloto) y `127.0.0.1:8200` (dataset de pruebas); ver `docs/operations/postgres.md`.

## Conectar con el backend

La dirección se configura con el ícono de enlace en la pantalla de inicio o en **Ajustes**, y se guarda en el dispositivo. El token de sesión se guarda solo en `flutter_secure_storage`.

| Dónde corre la app | Dirección |
|---|---|
| Emulador Android | `http://10.0.2.2:8000` (valor por defecto; `10.0.2.2` es el computador visto desde el emulador) |
| Teléfono Android por USB | Ejecutar `adb reverse tcp:8000 tcp:8000` y usar `http://127.0.0.1:8000` |
| Simulador iOS | `http://localhost:8000` |
| Teléfono en otra red | Una URL **HTTPS** publicada por el centro |

Para la consola de pruebas cambia el puerto a `8200` (en USB: `adb reverse tcp:8000 tcp:8200`).

HTTP solo se acepta en `localhost`, `127.0.0.1`, `::1`, `10.0.2.2` y `10.0.3.2`. Android bloquea el tráfico sin cifrar fuera de esos hosts (`network_security_config.xml`) e iOS solo lo permite para `localhost`. `adb reverse` encamina el puerto por el cable USB, así que el backend sigue escuchando solo en loopback: no hace falta abrirlo a la red Wi-Fi.

## Crear un usuario

```bash
bash infra/docker-local.sh compose exec backend python -m vigia_backend.users create --email operador@ejemplo.org --name "Operador de turno" --role operator
```

La contraseña se pide por terminal; no la pases como argumento.

## Ejecutar

Desde `apps/movil`:

```bash
flutter pub get
flutter devices          # elegir destino
flutter run -d <id>
```

## Dataset de pruebas

Si el backend apunta a la base `vigia_scoring`, la pantalla **Consultar** muestra **Caso del dataset de pruebas**. Elegir un caso (S01–S10) llena cámara, fecha, horario, radio y filtros; luego **Consultar trayectorias**. En la base del piloto el selector no aparece.

## Verificar

```bash
flutter analyze
flutter test
```

Las pruebas cubren el cliente HTTP (login, Bearer, 401, *timeouts*, mensajes de error, fechas sin zona horaria, casos del dataset), el modo demo y el llenado del formulario a partir de un caso.

## Comportamiento

- Endpoints usados: `/api/v1/auth/login`, `/auth/me`, `/auth/logout`, `/devices`, `/queries`, `/scenarios` y `POST /queries/{id}/export`.
- Cada petición tiene un límite de 15 s. Un 401 borra el token y vuelve al inicio de sesión; 403, 404, 422, 429 y 5xx muestran mensajes en español.
- Los horarios se eligen y se muestran en hora de Colombia (UTC−5, sin horario de verano) y viajan al backend en UTC, sin importar la zona horaria del teléfono.
- La exportación se comparte solo después de pedir al backend el JSON auditado.

## Pendiente antes de publicar

- Definir el identificador definitivo de la app. Hoy es `com.example.movil` en Android e iOS, y las tiendas no aceptan `com.example`. Al cambiarlo, actualizar también `userAgentPackageName` en `lib/widgets/map_panel.dart`, que identifica la app ante los servidores de mapas de OpenStreetMap.
- Si se espera uso intensivo, usar un proveedor de teselas propio o contratado: la política de OpenStreetMap no permite tráfico pesado sobre sus servidores públicos.
