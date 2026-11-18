# Migración móvil a React Native

## Decisión y estado

La implementación nueva usa **Expo prebuild** (Expo SDK 58, React Native 0.88
y TypeScript estricto). Se conserva `co.vigia.movil`, la versión `1.5.0`,
`versionCode`/`buildNumber` 6, los endpoints existentes y el contrato
[`detection-envelope-1.1.schema.json`](../packages/contracts/detection-envelope-1.1.schema.json).

La app React Native vive temporalmente en `apps/movil-rn/`; `apps/movil/` aún
contiene Flutter. El corte que elimina Flutter está aplazado hasta implementar
y probar una migración Android segura de sesión y credencial edge. No se debe
retirar el servicio Flutter ni mover las carpetas antes de resolverla. En
particular, el almacenamiento Android de Flutter Secure Storage está cifrado
con Android Keystore y no puede copiarse como texto ni migrarse desde las
preferencias normales. El servicio de migración Flutter/RN todavía no existe.

## Matriz de paridad actual

| Función | Estado | Implementación RN | Prueba/evidencia |
|---|---|---|---|
| Login, validaciones, sesión local y errores en español | Hecho en UI/API; migración de sesión 1.4 pendiente | `src/screens/LoginScreen.tsx`, `src/state/session.tsx`, `src/api/client.ts` | `src/screens/LoginScreen.test.tsx`, `src/api/client.test.ts` |
| Demo sin red, banner y marca de demostración | Hecho | `src/state/session.tsx`, `src/screens/QueryScreen.tsx` | `src/screens/QueryScreen.test.tsx` |
| Consultas, filtros, escenarios y horarios Bogotá↔UTC | Hecho | `src/screens/QueryScreen.tsx`, `src/components/BogotaDateTimeField.tsx`, `src/time/bogota.ts` | `src/screens/QueryScreen.test.tsx`, `src/time/bogota.test.ts` |
| Selección GPS/mapa y estados de permisos | Parcial; falta validación en dispositivo para permisos y servicios desactivados | `src/components/LocationPicker.tsx`, `src/screens/AdminTools.tsx` | `src/components/LocationPicker.test.tsx` |
| Mapa y cámaras; alta/mover edge solo admin | Parcial; falta una prueba de navegación/rol de punta a punta | `src/components/CameraMap.tsx`, `src/screens/AdminTools.tsx` | Tests de API/cliente; flujo Maestro aún no ejecutado |
| Token edge, emisión/rotación/revocación | Hecho para instalación RN nueva; migración de token Flutter 1.4 pendiente | `src/edge/config.ts`, `src/storage/secure.ts`, `src/screens/AdminTools.tsx` | `src/edge/config.test.ts`, `src/api/client.test.ts` |
| Resultados, exportación y campos de backend `license_plate`, `confirmation`, `has_thumbnail` | Parcial; campos y acciones admin conectados, faltan tests de render y rol en pantalla | `src/screens/ResultsScreen.tsx`, `src/api/client.ts`, `src/types/models.ts` | `src/api/client.test.ts` |
| Tamaño APK en aviso de actualización | Hecho | `src/update/UpdateHost.tsx`, `src/update/release.ts` | `src/update/release.test.ts` |
| Actualización Android con verificación SHA-256 | Hecho en el cliente; instalación real requiere dispositivo | `src/native/installer.ts`, módulo Android de cámara/instalador | `src/native/installer.test.ts` |
| Selección de cámara y servidor MJPEG Android | Hecho en código | `src/screens/CameraModeScreen.tsx`, `modules/vigia-camera-server/android/` | `src/screens/CameraModeScreen.test.tsx`; tests JVM descritos abajo |
| Servidor MJPEG iOS, auth, rutas y cliente lento | Parcial; adaptador Swift escrito pero pendiente de compilación en CI macOS | `modules/vigia-camera-server/ios/`, `src/native/mjpeg.ts` | `src/native/mjpeg.test.ts`; compilación iOS sin firma pendiente |
| Conversión de frames, orientación, letterbox, layouts y NMS | Hecho en lógica TypeScript; falta comprobar formatos de cámara en hardware | `src/edge/` y `src/native/` | `src/edge/domain.test.ts` |
| Tracker, predicción, dirección y votos de color | Parcial; cubiertos los casos unitarios principales, falta medir con video real | `src/edge/domain.ts` | `src/edge/domain.test.ts` |
| Motor: heartbeat y envío de snapshots | Parcial; faltan los casos de inferencia colgada y fallida y crops por vehículo | `src/edge/engine.ts` | `src/edge/engine.test.ts` |
| Outbox persistente, orden y rechazo al llenarse | Hecho en pruebas de unidad | `src/edge/outbox.ts` | `src/edge/outbox.test.ts` |
| Modelos y manifiestos | Hecho; los hashes se comparan con los manifiestos y existen los cuatro assets | `assets/models/` | `src/edge/modelManifest.test.ts` |
| E2E login → demo → consulta → resultados → historial y URL inválida | Parcial; flujos Maestro configurados, no ejecutados localmente | `.maestro/flows/` | Workflow `workflow_dispatch` opcional en `.github/workflows/movil.yml` |
| Persistencia de URL, sesión y configuración/token al actualizar desde Flutter 1.4.0 | Pendiente; bloquea el corte | `src/storage/`; se requiere `FlutterDataMigration` nativo | Sin prueba hasta implementar el puente seguro Android |

### CI y validaciones

- `npm run lint`: correcto, sin avisos.
- `npm run typecheck`: correcto.
- `npm test`: 14 suites, 56 pruebas correctas.
- `npm run doctor`: 20/20 verificaciones correctas después de alinear las
  dependencias al SDK 58 con `npx expo install`.
- `npx expo prebuild --clean --platform android`: correcto.
- `:vigia-camera-server:testDebugUnitTest`: 3 pruebas JVM correctas (rutas,
  auth y cliente lento).
- `assembleDebug`: no se pudo completar en este host Windows; CMake/Ninja de
  `react-native-nitro-modules` falla al crear un directorio de fuentes. La
  compilación Android de aceptación se ejecuta en el job Linux.
- iOS sin firma y compilación del adaptador Swift: pendientes del job macOS.
- Maestro: configurado para `workflow_dispatch`, aún no ejecutado.

No se editaron manualmente los proyectos nativos generados de la app. Los
artefactos versionados de `modules/*/android/build/` se retiraron y se
ignoraron; tampoco se versionan `.expo/` ni `android/` generado.

## Validación en dispositivo pendiente

No se ha afirmado paridad de hardware. Quedan pendientes:

- OPPO CPH2599: comparar el objetivo de aproximadamente 6,2 análisis/s,
  temperatura y batería.
- Sesión larga, pantalla bloqueada, pérdida/recuperación de red y persistencia
  de la outbox.
- Captura real, rotaciones, permisos, MJPEG y consumo desde `apps/vision`.
- Compilación iOS sin firma en CI; la falta de Mac/iPhone local no la bloquea.
- Verificar actualización desde Android 1.4.0 sin perder URL, sesión ni edge.

El corte final requiere primero un adaptador Android probado que lea el
almacenamiento Flutter Secure Storage existente mediante Android Keystore y
escriba los tokens en Expo SecureStore sin exponerlos en logs. Hasta entonces
se conservan Flutter, `movil-web` y los assets/fixtures de `apps/movil/`.
