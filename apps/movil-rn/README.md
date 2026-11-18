# App VIGÍA (React Native)

App Android de VIGÍA, con iOS compilado sin firma en CI. Expo SDK 58 (prebuild), React Native 0.88 y TypeScript estricto. Identificador `co.vigia.movil`, el mismo de la app Flutter anterior: se instala **encima** de ella y conserva el servidor, la sesión y el token del edge ([`FlutterDataMigration.kt`](./modules/vigia-camera-server/android/src/main/java/expo/modules/vigiacameraserver/FlutterDataMigration.kt)).

## Qué hace

| Modo | Para quién | Qué hace |
|---|---|---|
| **Operador / admin** | Personas con cuenta | Cámaras en el mapa con su estado real, consultas por punto, radio, horario, tipo y color (placa solo admin), rutas candidatas con su explicación, confirmación de pasos (admin), historial y exportación auditada |
| **Edge autónomo** | Un teléfono fijo frente a la vía | Detecta vehículos (YOLO26n TFLite), vota color y placa, sube un recorte por vehículo, envía eventos desde una cola en disco y un latido cada 30 s. El video no sale del teléfono |
| **Modo cámara** | Un teléfono que solo filma | Sirve MJPEG en la red local o por USB para que un nodo PC haga la detección |
| **Demo** | Cualquiera | Datos de ejemplo identificados como demostración, sin red |

Además: alta de edges y emisión, rotación y revocación de credenciales (admin), y aviso de versión nueva con verificación SHA-256 del APK.

## Estructura

```text
apps/movil-rn/
├── App.tsx                # Navegación, barra inferior y apertura
├── src/
│   ├── api/               # Cliente HTTP (zod) del backend
│   ├── components/        # ui.tsx (sistema del Figma), motion.tsx, mapa, vista de cámara
│   ├── edge/              # Motor del edge: tracker, color, placas, recortes, cola, latido
│   ├── native/            # Frame processor (VisionCamera), servidor MJPEG, instalador
│   ├── screens/           # Una pantalla por archivo
│   ├── state/             # Sesión y estado de los nodos
│   ├── storage/           # Almacenamiento seguro y migración desde Flutter
│   ├── theme/             # Colores, fuentes e iconos del Figma morado
│   └── update/            # Aviso de versión nueva
├── modules/vigia-camera-server/  # Módulo nativo: MJPEG, instalador y migración Flutter
├── plugins/withVigiaAndroid.js   # Firma release, minSdk y ajustes de Gradle
└── assets/models/         # Modelos TFLite y sus manifiestos
```

## Desarrollo

Requiere Node 20.19.4 o superior, JDK 21 y el Android SDK.

```bash
cd apps/movil-rn
npm ci
npm run typecheck && npm run lint && npm test && npm run doctor
npx expo prebuild --platform android   # genera android/ (no se versiona)
npx expo run:android                   # compila e instala en el teléfono conectado
```

Las animaciones usan Reanimated 4 (`src/components/motion.tsx`): curvas de salida sin rebote, de 110 a 420 ms, y sin movimiento si el sistema pide reducirlo. En Jest, `jest.setup.js` reemplaza Reanimated por un mock pequeño.

## Compilar el APK de distribución

La llave de firma es la misma de la app Flutter y **no está en GitHub**. El APK de CI se firma con la llave de depuración y no instala encima del publicado.

```bash
cd apps/movil-rn
export VIGIA_ANDROID_KEY_PROPERTIES=$HOME/py_vigia/apps/movil/android/key.properties
export EXPO_PUBLIC_VIGIA_DEFAULT_API=https://vigia-5dfe.mexicocentral.cloudapp.azure.com
npx expo prebuild --clean --platform android --no-install
cd android && ./gradlew assembleRelease --max-workers=2 -PreactNativeArchitectures=arm64-v8a,armeabi-v7a
# → android/app/build/outputs/apk/release/app-release.apk
```

Antes de cada versión, sube `version` y `android.versionCode` en `app.json`, y `edgeNodeVersion` en `src/edge/envelope.ts`.

## Publicar e instalar

```bash
H=vigia-5dfe.mexicocentral.cloudapp.azure.com
bash infra/azure/deploy.sh $H apk apps/movil-rn/android/app/build/outputs/apk/release/app-release.apk 1.5.0
```

`deploy.sh apk` sube el APK a `/descargas`, actualiza la página `/app` y escribe `app-version.json`. Desde ese momento cada app instalada muestra «Hay una versión más nueva». Con un tercer argumento (`… 1.5.0 1.5.0`) la versión pasa a ser **obligatoria**. La persona confirma la instalación en el teléfono: Android no permite instalar en silencio.

En un teléfono conectado por USB también se puede instalar directamente con `adb install -r app-release.apk`.

## Documentación relacionada

- [Teléfonos como edges](../../docs/operations/phone-edges.md): alta, operación, latido y límites
- [Recortes y aprendizaje](../../docs/operations/recortes.md)
- [ADR-003: migración a React Native](../../docs/adr/003-mobile-react-native-migration.md) · [historia de la migración](../../docs/migracion-react-native.md)
- [CI/CD](../../docs/operations/ci-cd.md)
