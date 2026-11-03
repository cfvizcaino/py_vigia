# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Operadores** (rol `operator`): consultan la red de cámaras para reconstruir el recorrido probable de un vehículo (tipo, color, punto, fecha, franja horaria y radio). Trabajan en sala de monitoreo, con pantallas encendidas muchas horas y luz baja.
- **Administradores** (rol `admin`): además auditan consultas y exportaciones, y emiten, rotan o revocan las credenciales de los nodos edge.
- **Visitantes sin cuenta**: conocen VIGÍA desde la landing y pueden abrir una demostración con datos de ejemplo, sin tocar el servicio central.

## Product Purpose

VIGÍA convierte detecciones aisladas de cámaras y teléfonos comunitarios en trayectorias estimadas de vehículos, en segundos. El video se procesa en el edge; al centro solo llegan metadatos. Éxito: un operador autorizado pasa de «un carro blanco pasó por aquí» a un conjunto ordenado de rutas candidatas con su explicación, sin revisar video manualmente.

## Positioning

Red colaborativa de cámaras y teléfonos con detección en el origen (YOLO en el edge), consultas solo por metadatos y rutas ajustadas a la red vial real (OSRM propio) con un puntaje explicable por tramo.

## Operating Context

- Piloto en Barranquilla (UTC−5), centro en una VM de Azure con HTTPS, FastAPI, PostgreSQL y OSRM.
- Flujo del operador: iniciar sesión → elegir punto de búsqueda en el mapa → filtrar → ver rutas candidatas, su línea de tiempo y la evidencia → exportar (auditado).
- Vistas actuales: Resumen, Cámaras (incluye vista MJPEG de la Tapo C110), Consultas, Trayectorias (historial de la sesión), Administración; además el etiquetador de placas.
- Hay app móvil (Flutter / React Native) con el mismo flujo de consulta.

## Capabilities and Constraints

- Stack: Next.js 16 (App Router), React 19, MapLibre GL, CSS plano en `src/app/globals.css`. Sin librería de componentes.
- La consola no es frontera de seguridad: las rutas API revalidan la sesión y el backend aplica roles.
- La demostración nunca reemplaza una consulta real fallida y siempre se etiqueta como tal.
- Los nodos simulados conservan su etiqueta; el estado registrado de una cámara no prueba que su transmisión esté disponible.
- Si falla OSRM se dibuja un enlace directo discontinuo y se dice.
- Terminología: «trayectoria estimada», «ruta candidata», «puntaje / 100», «detección», «punto de búsqueda», «nodo» / «edge».

## Brand Commitments

- Nombre: VIGÍA. Idioma: español de Colombia.
- Voz: sobria y precisa. Nunca promete identificación: una ruta es una estimación con puntaje de compatibilidad, no una probabilidad ni una prueba.
- Diseño de referencia: archivo Figma «VIGÍA-DESIGN» (fileKey `sppv7Uz23siZ14XWBAppao`), páginas WEB y MOBILE.

## Evidence on Hand

- Seed del backend con datos del 25 de agosto de 2026 desde las 09:30; 10 escenarios sintéticos de evaluación.
- Prueba de resiliencia del 08/10 con nodo simulado (248/248 eventos, sin duplicados) en `docs/evidence/`.
- No hay clientes, testimonios ni cifras comerciales: no inventarlos.

## Product Principles

1. Estimación, no acusación: toda ruta muestra su puntaje, su origen de datos y sus huecos.
2. Privacidad en el origen: el video se queda en el edge; la consola muestra metadatos.
3. Cada acción tiene autor: consultas, exportaciones y credenciales quedan auditadas.
4. Honestidad de estado: conectado, demo o sin conexión se distinguen siempre a simple vista.

## Accessibility & Inclusion

- Uso prolongado en penumbra: tema oscuro por defecto, contraste AA como mínimo y sin brillos que cansen.
- Navegación completa por teclado, foco visible y respeto por `prefers-reduced-motion` (ya existe en la consola actual).
