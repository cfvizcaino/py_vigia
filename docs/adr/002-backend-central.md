# ADR-002: backend central, modelo de datos y reconstrucción de rutas

## Contexto

Con el flujo cámara–visión–web validado, VIGIA necesita una plataforma central que administre dispositivos y detecciones, registre consultas y estime trayectorias a partir de varias cámaras. El primer prototipo no dispone de placa ni de identidad vehicular fuerte; tampoco conviene introducir microservicios, PostGIS ni MQTT antes de cerrar el caso de uso académico descrito en el PrimerInforme.

## Decisión

Se implementa `apps/backend/` como monolito modular en **Python + FastAPI + SQLAlchemy**, alineado con ADR-001 y con el nodo de visión:

- persistencia inicial en SQLite (Postgres/PostGIS diferido);
- modelo con `users`, `devices`, `device_links`, `detections`, `queries`, `route_results` y `route_result_detections`;
- `thumbnail_url` nullable: el esquema no asume envío de imágenes ni solo datos descriptivos;
- sin campos operativos de placa, marca o modelo en esta fase;
- proximidad de dispositivos por **Haversine** sobre `lat`/`lng`; distancias **por red vial** en `device_links` para velocidad implícita y penalización de huecos;
- identidad vehicular proxy: **tipo + color**;
- reconstrucción de rutas como **función pura** (`reconstruct_routes`), testeable sin base de datos;
- varias rutas candidatas por consulta, cada una con `confidence`, `rank` y `has_distant_gaps` — nunca una sola respuesta como certeza;
- seed determinista de Barranquilla para escenarios cercanos, distantes, ruido y vehículos similares;
- consulta HTTP `GET /api/v1/queries` que orquesta dispositivos cercanos, detecciones candidatas, el algoritmo y la persistencia del historial.

## Consecuencias

- El equipo mantiene un solo ecosistema Python para edge y centro; los tests del algoritmo usan pytest con casos fijos.
- La web podrá sustituir datos simulados consumiendo el API central sin acoplarse a YOLO ni a RTSP.
- Cambiar umbrales (500 m / 2 km, velocidades) o el escenario de prueba no requiere rediseñar la arquitectura.
- Auth real, MQTT, PostGIS y OCR de placas siguen fuera de alcance hasta nuevas decisiones.
- El seed fijo es un laboratorio reproducible; la edición cotidiana de datos puede hacerse vía CRUD HTTP sin reemplazar ese escenario de referencia.
