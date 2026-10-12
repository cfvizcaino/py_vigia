# Roadmap de cierre de VIGIA

Actualizado: 2026-10-12. Fuente de priorización: [`SegundoInforme.md`](../SegundoInforme.md), especialmente las secciones 11.4 y 15.

## Principio de priorización

Primero se cierra un flujo vertical medible: cámara → edge → backend → consulta → ruta vial explicable. Después se endurecen seguridad, actualización y evaluación. MQTT y PostGIS siguen sin desplazar ese objetivo.

Desde el 10/10 el flujo corre en operación sobre Azure, con despliegue continuo. Por eso se adelantaron etapas de visión de P2 que mejoran directamente la consulta: el color del vehículo y un seguimiento sin duplicados. Las placas (detección y OCR) son el siguiente bloque de visión.

## Estado ejecutivo

| Orden | Bloque | Estado | Criterio de salida |
|---:|---|---|---|
| 1 | P0.1 Ingestión edge→centro | **Cumplido.** Tapo C110 y teléfonos publican a Azure con token por cámara; sesión continua de 8 h (12/10) sin pérdidas ni duplicados | Un evento real aparece una vez en backend aunque se reenvíe |
| 2 | P0.2 VPN por nodo edge | WireGuard autogestionado preparado y probado en generador; **no activado**. Los edges publican por HTTPS con token propio, y las cámaras quedan en su red local | Handshake entre redes, cámara privada y aislamiento entre nodos |
| 3 | P0.3 Ruta ajustada a calles | OSRM v6 en producción (Azure) con alternativas ponderadas; falta ampliar cobertura y evaluación independiente | La línea sigue la red vial y declara cuándo no pudo hacerlo |
| 4 | P0.4 Autenticación y auditoría | **Cumplido en código y en operación.** Usuarios con `scrypt`, sesiones con bloqueo, roles en backend, auditoría, pantalla de administración y HTTPS público. Faltan las cuentas de operador reales y el límite de peticiones por IP | Operador/admin separados; preview, consulta y exportación protegidos |
| 5 | P0.5 Actualización y rollback | **Cumplido (11/10).** CI en GitHub Actions; imágenes en GHCR; el servidor despliega solo, migra, verifica salud y vuelve a la versión anterior si falla | Versión válida activa; versión defectuosa revierte automáticamente |
| 6 | P1.1 Evaluación independiente | Pendiente; existe el dataset sintético de puntajes como base | Ground truth versionado; top-k, secuencia y falsos enlaces reportados |
| 7 | P1.2 Resiliencia y E2E | Aprobado con nodo simulado (08/10: 248/248 eventos, 0 duplicados); la Tapo real ya corrió 8 h contra Azure. Falta repetir el corte de 5 min con la cámara real | Corte de 5 min, reenvío sin duplicados y flujo Compose verificado |
| 8 | P1.3 Carga y observabilidad | **Carga medida (12/10)** hasta 100 nodos simulados en Azure: cumple con 4–50 nodos y satura desde 50 msg/s; falta la observabilidad (métricas agregadas) | 4/10/25 nodos, p50/p95, saturación y métricas por nodo |
| 9 | P2 Evoluciones de visión | **En curso.** Hechos: detección en el teléfono, color del vehículo y seguimiento sin fragmentar. Siguiente: placas (detector + OCR) | Cada etapa medida con prueba de sitio y documentada |

## Hitos cumplidos

| Fecha | Hito | PR |
|---|---|---|
| 28/09 | Flujo vertical con la Tapo real: nodo de visión → ingestión idempotente (Detection Envelope 1.1) → consulta → consola | #3 |
| 30/09 | VPN WireGuard y OSRM autogestionados; credenciales de ingestión por cámara con hash, caducidad y revocación | #4 |
| 08/10 | Migraciones Alembic, rutas viales ponderadas y OSRM validado en Docker | #5 |
| 08/10 | P0.4: usuarios, sesiones, roles aplicados en el backend y auditoría de uso | #7 |
| 08/10 | Pantalla de administración: auditoría y credenciales de nodos | #8 |
| 09/10 | Piloto sobre PostgreSQL 17 con respaldos y prueba de restauración; dataset sintético de puntajes | #9 |
| 09/10 | P1.2: resiliencia edge→centro verificada; arreglos de la demo y botón Authorize en `/docs` | #10, #11, #12 |
| 10/10 | App móvil del operador (Flutter): login, cámaras en mapa, consultas, rutas, historial, exportación auditada | #13 |
| 10/10 | Teléfonos como edges, con fuente de video configurable y token propio; alta de edges desde la app | #14, #15 |
| 10/10 | Servidor central en Azure: HTTPS automático, solo 80/443 expuestos, SSH por llave, respaldos diarios | #16, #17 |
| 10/10 | App v1.0: modo cámara IP sin apps de terceros, APK firmado descargable e iOS compilado en CI | #18 |
| 11/10 | App v1.1: edge Android autónomo con YOLO26n en el teléfono, sin PC (≈6 análisis/s) | #19 |
| 11/10 | CI/CD: pruebas de backend (con Postgres), visión, web y móvil; despliegue continuo a Azure con rollback (P0.5) | #20, #21 |
| 12/10 | Color del vehículo en teléfono y nodo PC: 91,6 % en la prueba de sitio, votado entre cuadros ([detalle](./modeling/vehicle-color.md)) | #22 |
| 12/10 | Seguimiento sin fragmentar: el teléfono baja de 74 a 23 tracks/min y el color llega al 86 % de los vehículos ([detalle](./modeling/tracking.md)) | #23 |
| 12/10 | APK 1.2.0 publicado en `/descargar` | — |
| 12/10 | Benchmark de carga en Azure: 25 msg/s (50 nodos) con p95 de 152 ms, 0 pérdidas y 0 duplicados; consultas con p95 de 1,0 s con 10 operadores; reinicio bajo carga sin pérdidas. Hallazgo: a 200 msg/s el backend se bloquea y no se recupera solo ([evidencia](./evidence/benchmark-azure-20261012.md)) | — |
| 12/10 | Análisis de sensibilidad de umbrales y pesos del puntaje ([evidencia](./evidence/sensibilidad-puntaje-20261012.md)); segundo informe actualizado | — |

## Orden de ejecución siguiente

1. **Robustez del backend ante sobrecarga** (hallazgo del benchmark): pool que falla rápido con 503, concurrencia acotada, varios procesos y reinicio automático si el chequeo de salud falla; repetir la escalada.
1. **Consulta por color tolerante a desconocidos.** Que una búsqueda por color no descarte las detecciones sin color (la reconstrucción ya las trata como coincidencia débil).
2. **Placas.** Detector de placas medido con datos del sitio, OCR para placas colombianas y votación del texto por track; primero en el nodo PC y luego en el teléfono.
3. **Retención de eventos crudos** y heartbeat más espaciado sin vehículos, antes de sumar muchas cámaras (≈160 MB/día con 10 cámaras).
4. **Servicio en segundo plano en Android**, para un teléfono fijo con la pantalla apagada.
5. **Seguridad y cumplimiento:** licencia del repositorio (Ultralytics es AGPL-3.0), límite por IP y CSP en Caddy, respaldos fuera de Azure, política de datos personales (Ley 1581) y autorización de los tutores sobre el alojamiento.
6. **Evaluación y escala:** P1.1 con recorridos independientes, corte de 5 min con la cámara real y carga de 4/10/25 nodos (P1.3).
7. **Conectividad:** activar WireGuard cuando haya una segunda red con cámaras.

## Detalle de incrementos anteriores

### Incremento P0.1–P0.3 (hasta el 30/09)

#### Hecho en código

- Contrato `Detection Envelope 1.1` con `eventId`, `sessionId`, secuencia y versiones.
- Endpoint `POST /api/v1/ingest/detections` con idempotencia por evento y observación lógica.
- Cola edge persistente, ordenada y con reintento exponencial.
- Backend agregado a Compose sobre Python 3.12.
- Adaptador OSRM en servidor para dibujar la ruta sobre calles; fallback visual identificado.
- VPN WireGuard sin suscripción: inventario público validado, configuración por host y reglas nftables; proxy limitado a ingestión/salud. No se activó sobre la red real.
- Perfil Compose `routing` con OSRM v6.0.0 y procesamiento MLD; rutas locales por defecto sin fallback hacia el demo público.
- Credenciales de ingestión por cámara, hash, caducidad, revocación, CLI local y auditoría mínima. Pruebas de aislamiento y reintentos.

#### Falta para cerrar el incremento (estado del 30/09)

- Ejecutar cámara real + backend durante una sesión prolongada.
- Cortar conectividad cinco minutos y registrar cola, recuperación y latencia.
- Automatizar entrega/rotación de credenciales; su emisión individual y revocación local ya están implementadas.
- Ampliar el extracto al área metropolitana; los cuatro `nearest`, doce pares dirigidos y `Table` 4×4 ya pasaron en Docker con calles reales.
- Confirmar acceso UDP al centro o infraestructura institucional de relay; el usuario todavía no conoce la conectividad disponible.
- Validar pesos con recorridos independientes y tráfico/paradas: el seed usa tiempos supuestos que no siempre son compatibles con el nuevo grafo. No confundir puntajes con probabilidades calibradas.

### Incremento P0.4 (08/10)

Primer corte terminado: `INGEST_AUTH_MODE=device` vincula tokens revocables a cámaras y registra operaciones. Segundo corte: Alembic `0001`/`0002`, arranque que exige revisión vigente, adopción del MVP solo tras validar esquema y crear backup 0600; no se usa `create_all` operativo. [Credenciales](./operations/device-credentials.md) · [Migraciones](./operations/database-migrations.md).

Tercer corte terminado (08/10/2026): revisión Alembic `0003`; personas con hash `scrypt`, sesiones revocables con bloqueo por intentos; roles `operator`/`admin` aplicados en el backend; auditoría de inicios de sesión, consultas, exportaciones (generadas en servidor), previews, cambios y credenciales; emisión/revocación de credenciales de nodos por API de administrador; login en la consola web con cookie `HttpOnly`. [Acceso de personas](./operations/user-access.md).

Las tres pruebas negativas de aceptación tienen cobertura HTTP: anónimo sin consulta/preview/exportación, operador sin actualización ni credenciales, y nodo A incapaz de publicar como nodo B. Se validaron además contra el stack Compose real.

Pendiente para declarar P0.4 cerrado en operación:

1. Crear las cuentas reales de operador (en producción hoy hay 2 administradores y ningún operador).
2. ~~Pantalla de administración (personas y auditoría) en la web~~: hecha en #8.
3. ~~TLS~~ (hecho en Azure con Let's Encrypt, #16) y límite por IP en el proxy (pendiente). Evaluar OIDC/MFA.

No declarar la aplicación apta para exposición pública solo por tener VPN y login.

### Base del piloto (08/10/2026)

- PostgreSQL 17 en Compose con respaldo `pg_dump`, prueba de restauración y pruebas específicas; corrige reintentos concurrentes de ingestión que antes daban 500. [Guía](./operations/postgres.md).
- Dataset sintético de puntajes con verdad de terreno y evaluador (recall@k, Jaccard, enlaces falsos), en una consola aislada. Primer resultado: recall@1 0,286, recall@3 0,429, enlaces falsos 0,26. Hallazgo: el top-k no diversifica y en hora pico no recupera trayectorias. [Dataset](./operations/scoring-dataset.md). Es una base para P1.1, no su evaluación independiente.

### P1.2 (08/10/2026)

Corte de red de 5 minutos con reinicio del nodo, acuses perdidos y caídas de 15 s del backend y de PostgreSQL. Resultado: 248 eventos generados y guardados exactamente una vez, 115/115 observaciones y 4 reenvíos reconocidos como `duplicate`. Se corrigió el bloqueo de la cola edge ante un evento rechazado. [Evidencia](./evidence/p12-resiliencia-20261008.md) · [Procedimiento](./operations/resilience.md). Pendiente: repetir con la Tapo real en una sesión prolongada.

## Decisión sobre geometría de rutas

El algoritmo de correlación decide qué secuencia de cámaras es plausible; OSRM calcula una geometría conducible entre esas cámaras usando la red de OpenStreetMap. Esa línea no demuestra la calle realmente recorrida: representa el camino vial más plausible para visualizar la hipótesis. Cuando OSRM no está disponible, la consola muestra una unión directa discontinua y la etiqueta como estimación.

El backend ya sincroniza `device_links` desde OSRM Route con alternativas, distancias, tiempos y geometría. Se usa Route en lugar de Table para conservar las opciones completas; Table se valida como matriz de referencia. La consola consume la geometría puntuada, no recalcula siempre el camino rápido. Si existen trazas GPS intermedias se evaluará Match. La dirección de imagen se excluye hasta calibrar cámara→vía.
