# Roadmap de cierre de VIGIA

Actualizado: 2026-09-28. Fuente de priorización: [`SegundoInforme.md`](../SegundoInforme.md), especialmente las secciones 11.4 y 15.

## Principio de priorización

Primero se cierra un flujo vertical medible: cámara → edge → VPN → backend → consulta → ruta vial explicable. Después se endurecen seguridad, actualización y evaluación. MQTT, PostGIS y OCR no desplazan ese objetivo.

## Estado ejecutivo

| Orden | Bloque | Estado | Criterio de salida |
|---:|---|---|---|
| 1 | P0.1 Ingestión edge→centro | Implementado y probado; falta cámara real | Un evento real aparece una vez en backend aunque se reenvíe |
| 2 | P0.2 VPN por nodo edge | Configuración lista; falta prueba física | Cámara sin puerto público, edge y centro conectados por política mínima |
| 3 | P0.3 Ruta ajustada a calles | Implementado y validado con OSRM; falta servicio propio | La línea sigue la red vial y declara cuándo no pudo hacerlo |
| 4 | P0.4 Autenticación y auditoría | Pendiente | Operador/admin separados; preview, consulta y exportación protegidos |
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
- Diseño VPN documentado con Tailscale/WireGuard y política de mínimo privilegio.

### Falta para cerrar el incremento

- Ejecutar cámara real + backend durante una sesión prolongada.
- Cortar conectividad cinco minutos y registrar cola, recuperación y latencia.
- Autoaprovisionar credenciales distintas por nodo en vez del token común del MVP.
- Revisar las cámaras restantes con OSRM `nearest`; CAM-01→CAM-02 ya devolvió una geometría válida sobre Carrera 58 (354,4 m).
- Fijar una instancia OSRM propia o proveedor con SLA; el servidor público es solo para desarrollo.

## Siguiente incremento recomendado: P0.4

1. Migraciones Alembic para las tablas nuevas.
2. Usuarios con hash de contraseña o proveedor OIDC.
3. Roles `operator` y `admin` aplicados en backend, no solo en interfaz.
4. Auditoría de consultas, exportaciones, previews y comandos.
5. Tokens por dispositivo almacenados como hash y revocables.

La aceptación exige pruebas negativas: anónimo sin consulta/preview, operador sin actualización y nodo A incapaz de publicar como nodo B.

## Decisión sobre geometría de rutas

El algoritmo de correlación decide qué secuencia de cámaras es plausible; OSRM calcula una geometría conducible entre esas cámaras usando la red de OpenStreetMap. Esa línea no demuestra la calle realmente recorrida: representa el camino vial más plausible para visualizar la hipótesis. Cuando OSRM no está disponible, la consola muestra una unión directa discontinua y la etiqueta como estimación.

En la siguiente iteración el backend debe usar OSRM Table para recalcular `device_links` y alimentar al correlador con distancias/tiempos viales reales. Si más adelante existen puntos GPS intermedios, se usará OSRM Match; no corresponde usar map matching con solo posiciones fijas de cámaras.
