# VIGÍA móvil

Consola móvil del operador en Flutter: inicio de sesión, cámaras en mapa, consultas de trayectorias, resultados con geometría vial y explicación del puntaje, historial de la sesión, exportación auditada y ajustes. **Explorar demo** usa datos locales de ejemplo, siempre se identifica como demostración y nunca se activa como respaldo de una conexión fallida.

## Descargar

- **Android:** <https://vigia-5dfe.mexicocentral.cloudapp.azure.com/descargar>. APK firmado con la llave del proyecto y ya configurado con el servidor del piloto.
- **iPhone:** la compilación se verifica en GitHub Actions (macOS), pero instalarla en teléfonos requiere una cuenta de Apple Developer (TestFlight o ad hoc). Ver *Pendiente*.

## Edge autónomo

**Edge autónomo**, en el inicio de sesión o en Ajustes, convierte el teléfono en un edge completo. Detecta vehículos con YOLO26n en TensorFlow Lite (`assets/models/vehicles.*`) y publica el sobre 1.1 al servidor central con su propio token, sin PC. El código está en `lib/edge_mode/`:

- `preprocess`: rotación y letterbox en un isolate;
- `detector`: intérprete TFLite en su propio isolate;
- `detections`: decodificación YOLO26 y YOLOv8;
- `tracker`;
- `envelope`;
- `outbox`: cola en disco con reintentos;
- `edge_config`: token en almacenamiento seguro;
- `edge_engine`;
- `edge_mode_screen`.

Alta y operación en `docs/operations/phone-edges.md`.

## Modo cámara

**Usar este teléfono como cámara**, en el inicio de sesión o en Ajustes, convierte el teléfono en la cámara IP de un edge: MJPEG en el puerto 8080, por cable USB (solo `adb forward`) o en red local con clave. Detalles en `docs/operations/phone-edges.md`.

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

## Agregar edges (administradores)

En **Cámaras**, una cuenta admin ve **Agregar edge**: registra la cámara (identificador, nombre, equipo y ubicación por GPS o mapa) y emite su token, que se muestra una sola vez. Tocar una cámara abre sus credenciales para rotarlas o revocarlas. La instalación del token en el PC del nodo está en `docs/operations/phone-edges.md`.

## Dataset de pruebas

Si el backend apunta a la base `vigia_scoring`, la pantalla **Consultar** muestra **Caso del dataset de pruebas**. Elegir un caso (S01–S10) llena cámara, fecha, horario, radio y filtros; luego **Consultar trayectorias**. En la base del piloto el selector no aparece.

## Verificar

```bash
flutter analyze
flutter test
```

Las pruebas cubren el cliente HTTP (login, Bearer, 401, *timeouts*, mensajes de error, fechas sin zona horaria, casos del dataset), el modo demo y el llenado del formulario a partir de un caso.

## Comportamiento

- Endpoints usados: `/api/v1/auth/login`, `/auth/me`, `/auth/logout`, `/devices` (lectura; creación solo admin), `/queries`, `/scenarios`, `POST /queries/{id}/export` y, para admin, `/admin/credentials` y `/admin/devices/{id}/credentials`.
- Cada petición tiene un límite de 15 s. Un 401 borra el token y vuelve al inicio de sesión; 403, 404, 422, 429 y 5xx muestran mensajes en español.
- Los horarios se eligen y se muestran en hora de Colombia (UTC−5, sin horario de verano) y viajan al backend en UTC, sin importar la zona horaria del teléfono.
- La exportación se comparte solo después de pedir al backend el JSON auditado.

## Versión de distribución

- Identificador: `co.vigia.movil` en Android e iOS. No cambiarlo: los teléfonos tratarían la actualización como otra app.
- Firma de Android: llave propia en `~/.config/vigia/android/vigia-release.jks`, referenciada por `android/key.properties` (ignorado por Git). **Respáldala**: sin ella no se pueden publicar actualizaciones que se instalen encima de la versión actual. Sin `key.properties`, por ejemplo en CI, se firma con la llave de depuración.
- Servidor por defecto: se define al compilar.

```bash
flutter build apk --release --target-platform android-arm,android-arm64 \
    --dart-define=VIGIA_DEFAULT_API=https://vigia-5dfe.mexicocentral.cloudapp.azure.com
bash infra/azure/deploy.sh vigia-5dfe.mexicocentral.cloudapp.azure.com apk build/app/outputs/flutter-apk/app-release.apk 1.2.0
```

- Solo ARM (arm64 y armv7, todos los teléfonos reales): quitar x86_64, que sirve solo a emuladores, baja el APK unos 21 MB (hoy 76 MB con los modelos de vehículos, 10 MB, y de color, 6 MB).
- Ícono: `assets/icon/` y `dart run flutter_launcher_icons`.
- CI: `.github/workflows/movil.yml` analiza, prueba y compila Android e iOS (sin firma) en cada cambio.

## Pendiente

- iPhone: cuenta de Apple Developer (99 USD/año) para firmar y distribuir por TestFlight. Sin ella, solo se puede instalar desde Xcode en un Mac, y caduca a los 7 días con una cuenta gratuita.
- Servicio en primer plano en Android para que el Modo cámara y el Edge autónomo sigan con la pantalla bloqueada.
- Etapa de placas en el edge autónomo: detector de placas + OCR sobre el recorte de cada vehículo (ver `docs/operations/phone-edges.md`).
- Aceleración por GPU/NNAPI del intérprete (hoy CPU con 4 hilos).
- Proveedor de teselas propio si el uso crece (política de OpenStreetMap).
