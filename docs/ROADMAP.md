# Roadmap de cierre de VIGIA

Actualizado: 2026-09-30. Fuente de priorización: [`SegundoInforme.md`](../SegundoInforme.md), especialmente las secciones 11.4 y 15.

## Principio de priorización

Primero se cierra un flujo vertical medible: cámara → edge → VPN → backend → consulta → ruta vial explicable. Después se endurecen seguridad, actualización y evaluación. MQTT, PostGIS y OCR no desplazan ese objetivo.

## Estado ejecutivo

| Orden | Bloque | Estado | Criterio de salida |
|---:|---|---|---|
| 1 | P0.1 Ingestión edge→centro | Flujo con cámara real comprobado el 28/09; falta ensayo prolongado | Un evento real aparece una vez en backend aunque se reenvíe |
| 2 | P0.2 VPN por nodo edge | WireGuard autogestionado preparado y generador probado; endpoint público por confirmar | Handshake entre redes, cámara privada y aislamiento entre nodos |
| 3 | P0.3 Ruta ajustada a calles | OSRM probado en Docker con extracto real; alternativas dirigidas, pesos y geometría evaluada; falta cobertura/evaluación independiente | La línea sigue la red vial y declara cuándo no pudo hacerlo |
| 4 | P0.4 Autenticación y auditoría | Tokens por cámara, migraciones Alembic, usuarios con contraseña, sesiones, roles `operator`/`admin` en backend y auditoría de uso; validado en Docker Compose | Operador/admin separados; preview, consulta y exportación protegidos |
| 5 | P0.5 Actualización y rollback | Pendiente | Versión válida activa; versión defectuosa revierte automáticamente |
| 6 | P1.1 Evaluación independiente | Pendiente | Ground truth versionado; top-k, secuencia y falsos enlaces reportados |
| 7 | P1.2 Resiliencia y E2E | Pendiente | Corte de 5 min, reenvío sin duplicados y flujo Compose verificado |
| 8 | P1.3 Carga y observabilidad | Pendiente | 4/10/25 nodos, p50/p95, saturación y métricas por nodo |
| 9 | P2 Evoluciones | En espera | MQTT/PostGIS/OCR solo con P0 y P1 cerrados |

## Incremento actual: P0.1–P0.3

### Hecho en código

- Contrato `Detection Envelope 1.1` con `eventId`, `sessionId`, secuencia y versiones.
- Endpoint `POST /api/v1/ingest/detections` con idempotencia por evento y observación lógica.
- Cola edge persistente, ordenada y con reintento exponencial.
- Backend agregado a Compose sobre Python 3.12.
- Adaptador OSRM en servidor para dibujar la ruta sobre calles; fallback visual identificado.
- VPN WireGuard sin suscripción: inventario público validado, configuración por host y reglas nftables; proxy limitado a ingestión/salud. No se activó sobre la red real.
- Perfil Compose `routing` con OSRM v6.0.0 y procesamiento MLD; rutas locales por defecto sin fallback hacia el demo público.
- Credenciales de ingestión por cámara, hash, caducidad, revocación, CLI local y auditoría mínima. Pruebas de aislamiento y reintentos.

### Falta para cerrar el incremento

- Ejecutar cámara real + backend durante una sesión prolongada.
- Cortar conectividad cinco minutos y registrar cola, recuperación y latencia.
- Automatizar entrega/rotación de credenciales; su emisión individual y revocación local ya están implementadas.
- Ampliar el extracto al área metropolitana; los cuatro `nearest`, doce pares dirigidos y `Table` 4×4 ya pasaron en Docker con calles reales.
- Confirmar acceso UDP al centro o infraestructura institucional de relay; el usuario todavía no conoce la conectividad disponible.
- Validar pesos con recorridos independientes y tráfico/paradas: el seed usa tiempos supuestos que no siempre son compatibles con el nuevo grafo. No confundir puntajes con probabilidades calibradas.

## Incremento en curso: P0.4

Primer corte terminado: `INGEST_AUTH_MODE=device` vincula tokens revocables a cámaras y registra operaciones. Segundo corte: Alembic `0001`/`0002`, arranque que exige revisión vigente, adopción del MVP solo tras validar esquema y crear backup 0600; no se usa `create_all` operativo. [Credenciales](./operations/device-credentials.md) · [Migraciones](./operations/database-migrations.md).

Tercer corte terminado (08/10/2026): revisión Alembic `0003`; personas con hash `scrypt`, sesiones revocables con bloqueo por intentos; roles `operator`/`admin` aplicados en el backend; auditoría de inicios de sesión, consultas, exportaciones (generadas en servidor), previews, cambios y credenciales; emisión/revocación de credenciales de nodos por API de administrador; login en la consola web con cookie `HttpOnly`. [Acceso de personas](./operations/user-access.md).

Las tres pruebas negativas de aceptación tienen cobertura HTTP: anónimo sin consulta/preview/exportación, operador sin actualización ni credenciales, y nodo A incapaz de publicar como nodo B. Se validaron además contra el stack Compose real.

Pendiente para declarar P0.4 cerrado en operación:

1. Crear las cuentas reales y retirar el uso del operador del seed.
2. Pantalla de administración (personas y auditoría) en la web; hoy es CLI + API.
3. TLS y límite por IP en el proxy si la consola sale de loopback/VPN. Evaluar OIDC/MFA.

No declarar la aplicación apta para exposición pública solo por tener VPN y login.

## Orden de ejecución siguiente

1. Conectividad: confirmar IP/puerto UDP y validar dos redes con [WireGuard](./operations/remote-camera-vpn.md).
2. Cartografía: ampliar cobertura y evaluar [ranking ponderado](./architecture/weighted-routes.md) con recorridos independientes; OSRM local ya responde.
3. P0.5: actualización con rollback automático; P0.4 queda en operación (cuentas reales y TLS).
4. Medir desconexión de cinco minutos y carga 4/10/25 nodos; dimensionar con evidencia antes de declarar escalabilidad.

## Decisión sobre geometría de rutas

El algoritmo de correlación decide qué secuencia de cámaras es plausible; OSRM calcula una geometría conducible entre esas cámaras usando la red de OpenStreetMap. Esa línea no demuestra la calle realmente recorrida: representa el camino vial más plausible para visualizar la hipótesis. Cuando OSRM no está disponible, la consola muestra una unión directa discontinua y la etiqueta como estimación.

El backend ya sincroniza `device_links` desde OSRM Route con alternativas, distancias, tiempos y geometría. Se usa Route en lugar de Table para conservar las opciones completas; Table se valida como matriz de referencia. La consola consume la geometría puntuada, no recalcula siempre el camino rápido. Si existen trazas GPS intermedias se evaluará Match. La dirección de imagen se excluye hasta calibrar cámara→vía.
