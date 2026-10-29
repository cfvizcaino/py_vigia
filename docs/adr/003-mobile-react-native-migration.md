# ADR-003: Migración de la aplicación móvil a React Native

- **Estado:** Diferida / bloqueada por falta de entorno de validación.
- **Fecha:** 2026-10-28
- **Contexto:** La app Flutter existente tiene consola, administración, cámara
  MJPEG y edge autónomo con dos modelos TFLite. La migración debe preservar
  `co.vigia.movil`, el contrato de backend y el rendimiento en dispositivo.

## Decisión

No retirar Flutter ni declarar elegida una arquitectura RN de producción hasta
que el spike de cámara, inferencia, overlay, MJPEG y liberación de recursos
compile y se ejecute en Android **e iOS**. Se mantiene la app existente como
producto y referencia verificable.

Expo SDK 58 con React Native 0.88 y development builds queda como **candidato
provisional**, no como decisión aprobada: el changelog oficial lo identifica
como estable y el encargo prefiere Expo prebuild si los módulos críticos son
compatibles. Expo Go queda descartado porque no contiene los módulos nativos
requeridos. No se decide bare frente a Expo prebuild sin prueba de integración
de VisionCamera, TFLite, mapas y MJPEG.

## Evidencia y consecuencias

- La fuente oficial consultada anuncia Expo SDK 58 / React Native 0.88; las
  fuentes de VisionCamera y Fast TFLite confirman que hay implementaciones
  nativas y procesamiento de cuadros de alta frecuencia, pero no demuestran
  compatibilidad mutua con esa combinación ni con los manifiestos de VIGÍA.
- El host actual es Windows, sin Node/npm ni Xcode/CocoaPods, sin dispositivo
  conectado y sin el teléfono OPPO usado para el benchmark. No se puede ejecutar
  el build/test React Native ni validar el requisito iOS en este entorno.
- Aplazar conserva la app y el build Android Flutter reproducible (la firma de
  distribución no se validó) y evita reemplazar comportamiento real por
  pantallas vacías, degradar seguridad o retirar funcionalidades que todavía no
  tienen alternativa probada.
- La consecuencia inmediata es que CI, documentación operativa y la ubicación
  final `apps/movil/` siguen describiendo Flutter. Cambiarlas antes de disponer
  del proyecto RN y de pruebas rompería el flujo existente.
- El ADR deberá revisarse después del spike. Si Expo prebuild impide una
  capacidad crítica, comparar un módulo nativo propio/API TypeScript común y
  bare React Native con una prueba reproducible; no asumir que Flutter requiere
  dos bases de código ni que RN elimina todo el código nativo.

## Referencias

- [Expo SDK 58](https://expo.dev/changelog/sdk-58)
- [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Registro y matriz de paridad de la migración](../migracion-react-native.md)
