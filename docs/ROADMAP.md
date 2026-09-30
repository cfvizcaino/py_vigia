# Roadmap de cierre de VIGIA

Actualizado: 2026-09-30. Fuente de priorización: [`SegundoInforme.md`](../SegundoInforme.md), especialmente las secciones 11.4 y 15.

## Principio de priorización

Primero se cierra un flujo vertical medible: cámara → edge → VPN → backend → consulta → ruta vial explicable. Después se endurecen seguridad, actualización y evaluación. MQTT, PostGIS y OCR no desplazan ese objetivo.

## Estado ejecutivo

| Orden | Bloque | Estado | Criterio de salida |
|---:|---|---|---|
| 1 | P0.1 Ingestión edge→centro | Flujo con cámara real comprobado el 28/09; falta ensayo prolongado | Un evento real aparece una vez en backend aunque se reenvíe |
| 2 | P0.2 VPN por nodo edge | WireGuard autogestionado preparado y generador probado; endpoint público por confirmar | Handshake entre redes, cámara privada y aislamiento entre nodos |
| 3 | P0.3 Ruta ajustada a calles | Adaptador probado; servicio OSRM local y procesamiento preparados; falta grafo real | La línea sigue la red vial y declara cuándo no pudo hacerlo |
| 4 | P0.4 Autenticación y auditoría | En curso: tokens por cámara, caducidad/revocación y auditoría de credenciales implementados | Operador/admin separados; preview, consulta y exportación protegidos |
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
- Revisar las cámaras restantes con OSRM `nearest`; CAM-01→CAM-02 ya devolvió una geometría válida sobre Carrera 58 (354,4 m).
- Confirmar acceso UDP al centro o infraestructura institucional de relay; el usuario todavía no conoce la conectividad disponible.
- Construir y validar el grafo regional del OSRM propio. No depender de planes gratuitos con cuotas comerciales ni de infraestructura pagada obligatoria.

## Incremento en curso: P0.4

Primer corte terminado: `INGEST_AUTH_MODE=device` rechaza acceso anónimo y tokens comunes, vincula el token a `cameraId`, revoca y registra operaciones de credenciales. Se crean tablas aditivas con `create_all`; esto no sustituye migraciones versionadas. [Operación de credenciales](./operations/device-credentials.md).

Pendiente para cerrar P0.4:

1. Migraciones Alembic para las tablas nuevas.
2. Usuarios con hash de contraseña o proveedor OIDC.
3. Roles `operator` y `admin` aplicados en backend, no solo en interfaz.
4. Auditoría de consultas, exportaciones, previews y comandos.
5. Integrar las credenciales ya implementadas con aprovisionamiento y auditoría de administradores.

La aceptación exige pruebas negativas: anónimo sin consulta/preview, operador sin actualización y nodo A incapaz de publicar como nodo B.

La última condición ya tiene pruebas HTTP. Las otras dos siguen pendientes; no declarar la aplicación apta para exposición pública por tener VPN. El proxy de la VPN no publica los CRUD y Compose enlaza los servicios a loopback.

## Orden de ejecución siguiente

1. Conectividad: confirmar IP/puerto UDP y validar dos redes con [WireGuard](./operations/remote-camera-vpn.md).
2. Cartografía: preparar extracto regional y validar [OSRM propio](./operations/osrm-self-hosted.md).
3. Continuar P0.4: migraciones, sesiones de personas, roles y auditoría de uso.
4. Medir desconexión de cinco minutos y carga 4/10/25 nodos; dimensionar con evidencia antes de declarar escalabilidad.

## Decisión sobre geometría de rutas

El algoritmo de correlación decide qué secuencia de cámaras es plausible; OSRM calcula una geometría conducible entre esas cámaras usando la red de OpenStreetMap. Esa línea no demuestra la calle realmente recorrida: representa el camino vial más plausible para visualizar la hipótesis. Cuando OSRM no está disponible, la consola muestra una unión directa discontinua y la etiqueta como estimación.

En la siguiente iteración el backend debe usar OSRM Table para recalcular `device_links` y alimentar al correlador con distancias/tiempos viales reales. Si más adelante existen puntos GPS intermedios, se usará OSRM Match; no corresponde usar map matching con solo posiciones fijas de cámaras.
