# Migración móvil React Native

**Estado: bloqueada antes del spike nativo.** Este documento registra la línea
base, la matriz de paridad exigida y la evidencia del bloqueo. No es una
declaración de migración completada: `apps/movil/` sigue siendo Flutter y no se
creó una implementación React Native no compilable como sustituto.

## Alcance y estado

- Rama de trabajo: `migration-rn`.
- HEAD de partida: `ee26c62` (merge de `feat/recortes-telefono`); el commit
  referido en el encargo, `c960203`, existe en el historial y corresponde a
  `feat(recortes): el teléfono envía un recorte por vehículo (app 1.4.0)`.
- Identidad actual que debe preservarse: `co.vigia.movil` en Android e iOS;
  versión Flutter `1.4.0+5`.
- No se modificaron las pantallas, contratos, backend, infraestructura ni CI.
  La app original se conserva porque aún no existe un reemplazo con paridad
  probada.

## Bloqueo comprobado

El criterio de entrada a la implementación funcional es demostrar en Android e
iOS captura, acceso a cuadros sin copias masivas por el bridge, ejecución de los
dos modelos TFLite, overlay tras rotación y letterbox, MJPEG accesible y
liberación de recursos. Este entorno es Windows y:

- No tiene `node`, `npm` ni `npx`; por tanto no puede instalar, verificar,
  ejecutar pruebas ni generar el lockfile de una app React Native.
- No tiene macOS, Xcode ni CocoaPods. Una compilación local iOS y la ejecución
  en simulador/dispositivo iOS no son posibles desde este host.
- Android Studio y Android SDK sí están instalados; el JDK está incluido en
  Android Studio, aunque `java` no está en `PATH`. `adb devices -l` no reporta
  dispositivos y no hay un dispositivo físico conectado.
- No se dispone del OPPO CPH2599 documentado para comparar las 6,2
  inferencias/s de referencia, ni de un iPhone para validar cámara, formatos,
  red local y permisos.
- Un build remoto requeriría configurar y autorizar un servicio externo y no
  reemplaza la prueba en hardware solicitada. No se usó EAS ni se asumió que
  exista una cuenta o una credencial.

Sin ese spike no hay evidencia para resolver la compatibilidad RN 0.88/Expo SDK
58 con los módulos nativos críticos, ni para afirmar que un scaffold conserva
las funciones. Por ello no se reemplazó Flutter, no se borraron archivos y no
se cambió `.github/workflows/movil.yml` a una CI de una app inexistente.

## Línea base Flutter

Ejecutada en Windows antes de cambios de producto, con Flutter 3.47.2 / Dart
3.13.2 (el README documenta 3.47.7):

| Comando | Resultado | Observación |
|---|---|---|
| `flutter analyze` | Correcto | `No issues found!` |
| `flutter test` | Fallido: 66 aprobadas, 2 fallidas | Los fallos son los que se detallan debajo; no fueron introducidos por esta rama. |
| `flutter build apk --debug` | Correcto | Gradle generó `build/app/outputs/flutter-apk/app-debug.apk`. Mostró avisos de API restringida de Java y compatibilidad source/target 8 de dependencias Android. |
| `adb devices -l` | Sin dispositivos | No se validó cámara ni rendimiento en dispositivo. |
| Build iOS | No ejecutable | El host es Windows y no tiene Xcode/CocoaPods. |

Fallos observados en la línea base:

1. `edge_mode_test.dart`, prueba de envío del recorte por track: la limpieza de
   su directorio temporal termina con `PathAccessException` porque el archivo
   continúa en uso por otro proceso.
2. `edge_mode_test.dart`, prueba de assets: el test busca el texto
   `assets/models\colors.json`, mientras `pubspec.yaml` declara el path
   portable `assets/models/colors.json`. Es una aserción sensible al separador
   de Windows.

Flutter generó cambios de fin de línea en registrants de plataformas no
usadas durante `analyze`/`build`; se restauraron esos archivos y el worktree
quedó limpio antes de agregar esta documentación.

## Matriz de paridad

Cada fila permanece **pendiente de migración**. Las rutas RN indicadas son
destinos propuestos, no archivos ya implementados. Las pruebas Flutter
existentes constituyen fixtures/especificación que deben migrarse y ampliarse;
no demuestran paridad React Native.

| Función actual | Fuente de referencia Flutter | Destino RN propuesto | Prueba de aceptación RN | Estado |
|---|---|---|---|---|
| Inicio, restauración de sesión, demo local y banner de seguridad | `lib/main.dart`, `lib/app.dart`, `lib/session.dart`, `test/widget_test.dart` | `src/app`, `src/navigation`, `src/state/session` | Restaurar token; demo local y siempre marcada; navegación principal; cierre de sesión | No migrado |
| Login, API tipada, URL HTTPS/local, timeout, 401 y errores localizados | `lib/api_client.dart`, `lib/session.dart`, `test/api_client_test.dart` | `src/api`, `src/storage/secure` | Bearer, rutas/payloads snake_case, timeout de 15 s, 401, códigos 400/403/404/409/422/429/5xx | No migrado |
| UTC de API y hora fija Bogotá | `lib/models.dart`, `lib/widgets/shared_widgets.dart`, `test/api_client_test.dart` | `src/time` | UTC con/sin offset y UTC−5 independiente de la zona del teléfono | No migrado |
| Cámaras, mapa OSM, selección de punto y GPS | `lib/screens/cameras_screen.dart`, `lib/widgets/map_panel.dart`, `lib/widgets/location_picker.dart` | `src/screens/cameras`, `src/maps`, adaptador de ubicación | Marcadores, estado, polilíneas, selección manual/GPS y permiso denegado | No migrado |
| Formularios de consulta y escenarios S01–S10 | `lib/screens/cameras_screen.dart`, `lib/models.dart`, `lib/session.dart`, `test/widget_test.dart` | `src/screens/query`, `src/api/scenarios` | Filtros, conversión horaria, escenarios y 404 vacío sin bloquear login | No migrado |
| Resultados, puntajes, geometría vial/directa, timeline y exportación auditada | `lib/screens/results_screen.dart`, `lib/models.dart`, `lib/session.dart`, `test/api_client_test.dart` | `src/screens/results`, `src/api/queries` | DTOs, orden/confianza/explicación, saltos, fallback visual, export solo vía POST y no en demo | No migrado |
| Historial de sesión, máximo 20 | `lib/screens/history_screen.dart`, `lib/session.dart` | `src/state/history`, `src/screens/history` | Reapertura, límite 20, limpieza en logout | No migrado |
| Alta/admin de edge, credenciales, ubicaciones, fuentes e instrucciones | `lib/screens/edges_screen.dart`, `lib/edge_source.dart`, `lib/api_client.dart`, `test/api_client_test.dart`, `test/camera_mode_test.dart` | `src/screens/edges`, `src/api/admin`, `src/edge/sources` | Rol admin, validadores, token de una sola vista, emitir/listar/revocar y verificación de token | No migrado |
| Modo cámara, preview, cuadros YUV/BGRA y servidor MJPEG autenticado | `lib/camera_mode/`, `test/camera_mode_test.dart` | `src/native/camera`, API TS común + implementaciones nativas | Preview Android/iOS; `/video`, `/shot.jpg`, `/status`, 404/405, Basic/query key, cliente lento, pausa/reanudación y cierre | No migrado; spike bloqueado |
| Manifiestos, preprocesamiento, letterbox, formatos, rotación y crops | `lib/edge_mode/detector.dart`, `lib/edge_mode/preprocess.dart`, `lib/camera_mode/frame_encoder.dart`, `test/edge_mode_test.dart` | `src/edge/model`, `src/native/frames` | Hash, layout, formas y etiquetas; YUV420/BGRA, 0/90/180/270, NCHW y fixtures ±1 px | No migrado |
| Inferencia de vehículos y colores sin bloquear UI | `lib/edge_mode/detector.dart`, `lib/edge_mode/colors.dart` | Worklet/JSI o módulo nativo común | Modelo detector y clasificador reales, formatos reales, timeout, cuadro concurrente descartado y error de color seguro | No migrado; spike bloqueado |
| Decodificadores YOLOv8/11 y YOLO26; tracking/dirección/color | `lib/edge_mode/detections.dart`, `lib/edge_mode/tracker.dart`, `lib/edge_mode/colors.dart`, `test/edge_mode_test.dart` | `src/edge/decode`, `src/edge/tracker` | Fixtures deterministas de ambas salidas, thresholds, IoU, hits, retención, predicción, dirección y votos | No migrado |
| Envelope 1.1, snapshots, heartbeat, recortes por track | `lib/edge_mode/envelope.dart`, `lib/edge_mode/edge_engine.dart`, `lib/edge_mode/preprocess.dart` | `src/edge/envelope`, `src/edge/engine` | UUID v4 seguro, schema JSON, timestamps milisegundo UTC, recorte 224 px/margen 10%/JPEG 80/≤64 KiB | No migrado |
| Outbox disk-first, orden, retry, prioridad y reinicio | `lib/edge_mode/outbox.dart`, `test/edge_mode_test.dart` | `src/edge/outbox` con archivos atómicos | Persistencia antes de enviar, rename, estado al reiniciar, clasificación HTTP, jitter/backoff y límites | No migrado |
| Actualizaciones, SHA-256 e instalador Android | `lib/app_update.dart`, `lib/app_update_prompt.dart`, `test/app_update_test.dart`, manifiestos nativos | `src/updates`, módulo Android de instalación | Semver, comprobación de hash, obligatorio/opcional, postergación 24 h; iOS nunca instala APK | No migrado |
| Identidad, permisos, red local y política TLS | Configuración `android/`, `ios/`, `pubspec.yaml` | Config de Expo prebuild y plugins nativos | `co.vigia.movil`, permisos mínimos, cleartext solo hosts locales, ATS, icono/splash/orientación | No migrado |
| Distribución y web `movil-web` | `.github/workflows/movil.yml`, `compose.yaml`, README móvil | CI Android+iOS y decisión de retirar o limitar web | npm ci, lint/typecheck/tests y builds; no simular cámara/edge en web | No migrado |

## Evaluación preliminar de dependencias críticas

Evaluación de fuentes oficiales/repositorios consultados el 28/10/2026. Son
candidatas; no están instaladas, fijadas en un lockfile ni aceptadas por un
spike. La compatibilidad con la combinación final de Expo/RN y con los modelos
reales sigue abierta.

| Candidata | Evidencia/versionado | Plataformas / arquitectura | Licencia | Riesgo y alternativa |
|---|---|---|---|---|
| Expo SDK 58 / React Native 0.88 | Changelog oficial anuncia SDK 58 el 15/10/2026 y RN 0.88; development builds requieren un build nativo, no Expo Go. | Expo prebuild/development build; build local necesita Android Studio o Xcode. | No aplica como única dependencia; revisar licencias transitivas al instalar. | Candidata estable más nueva encontrada. Aún no se probó `expo-doctor`, prebuild ni compatibilidad de plugins. Alternativa: bare RN, solo si un spike concreto demuestra menor riesgo. |
| `react-native-vision-camera` | Último release consultado: v5.2.3, 20/08/2026. Su guía V5 usa `CameraFrameOutput` y runtime de worklets; exige disponer cada frame. | Android/iOS; frame output de alta frecuencia sin pasar cada cuadro por el bridge JS tradicional. Paquetes nativos separados y requisitos de worklets. | MIT, según el repositorio. | Buen candidato para captura; no se validó RN 0.88, prebuild, disponibilidad de worklets compatibles ni formatos YUV/BGRA concretos. Alternativa: módulo de cámara nativo propio detrás de interfaz TS común. |
| `react-native-fast-tflite` | Último release consultado: v3.0.1, 21/04/2026; repo declara Nitro Modules y buffers sin copia. | Código Android/iOS y C++; requiere validar Nitro/arquitectura nueva, delegates y configuración de Expo. | MIT, según `LICENSE`. | No se ejecutó ningún modelo. NCHW float32, salida `[1,300,6]`, clasificador `[1,8]`, digest y ejecución sobre el formato de frame real deben probarse antes de fijarla. Alternativa: LiteRT/TFLite nativo Kotlin/Swift tras spike medible. |
| `@maplibre/maplibre-react-native` | Repositorio oficial describe wrapper de MapLibre Native para Android+iOS y anuncia licencia MIT. No se fijó versión npm. | Android/iOS; módulo nativo. | MIT, según el repositorio. | Adecuado como candidato sin clave obligatoria de Google; no se verificó la configuración de teselas OSM ni el plugin Expo para SDK 58. Alternativa: evaluar otra librería de mapas no ligada a Google, sin simular capacidades nativas. |

Fuentes consultadas:

- [Expo SDK 58](https://expo.dev/changelog/sdk-58)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [VisionCamera releases](https://github.com/margelo/react-native-vision-camera/releases) y [frame output](https://visioncamera.margelo.com/docs/frame-output)
- [Fast TFLite releases](https://github.com/margelo/react-native-fast-tflite/releases)
- [MapLibre React Native](https://github.com/maplibre/maplibre-react-native)
- [React Native releases](https://reactnative.dev/releases/)

## Contratos, seguridad y rendimiento a preservar

El contrato de eventos es
[`detection-envelope-1.1.schema.json`](../packages/contracts/detection-envelope-1.1.schema.json);
los assets deben permanecer sin cambios. Los manifiestos actuales declaran
detector float32 NCHW `1×3×320×320` → `1×300×6` y clasificador float32 NCHW
`1×3×128×128` → `1×8`. La app actual implementa transformaciones, tracking,
dirección, votación de color, crops y outbox en Dart; no se debe sustituir esa
lógica por una aproximación visual o por video enviado al centro.

La migración debe mantener: token de persona solo en Keychain/Keystore; token
de edge fuera de logs y preferencias no cifradas; demo siempre explícita;
los encabezados de autenticación de sesión y `X-Vigia-Device-Token` sin cambios;
HTTP solo para hosts locales; video consumido por el edge cercano, no subido al
centro; y eliminación de recursos de cámara, worklets, intérpretes, sockets y
archivos temporales al pausar/salir.

No hay benchmark React Native. La única referencia de rendimiento localizada
es la medición Flutter documentada en `docs/operations/phone-edges.md`: unos
6,2 análisis/s en OPPO CPH2599. No se midieron CPU, memoria, temperatura,
latencia ni sesión prolongada para React Native. La regresión relativa queda
**sin medir**, no aprobada.

La licencia AGPL-3.0 de Ultralytics ya está señalada en el roadmap del proyecto;
una migración móvil no la resuelve ni debe ocultarla. El inventario definitivo
de licencias requiere lockfile y análisis de dependencias realmente instaladas.

## Acciones pendientes para desbloquear el corte

Hace falta un entorno de desarrollo autorizado con Node/npm, Android Studio/JDK
y un emulador o teléfono Android; y un Mac con Xcode/CocoaPods, simulador o
iPhone. Para cumplir la prueba de rendimiento comparativa hace falta además el
OPPO CPH2599 o aceptar formalmente otro dispositivo de referencia. Después se
podrá ejecutar el spike antes de escribir la app completa y decidir Expo
prebuild frente a bare con evidencia.

Hasta entonces se mantienen sin cambios la app Flutter, su workflow y el perfil
`movil-web`; no se presenta una compilación Flutter como validación React
Native ni se marca ninguna fila de paridad como completada.
