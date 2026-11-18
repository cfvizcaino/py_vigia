# Backend central de VIGIA

Monolito modular (ADR-001) con FastAPI + SQLAlchemy. PostgreSQL 17 en el despliegue con Compose ([guía](../../docs/operations/postgres.md)); SQLite para desarrollo rápido y pruebas en memoria.
Modelo alineado con [docs/architecture/data-model.md](../../docs/architecture/data-model.md).

## Alcance actual

- Tablas: `users`, `devices`, `device_links`, `detections`, `queries`, `route_results`, `route_result_detections`.
- CRUD HTTP de `devices` y `detections`.
- Seed Barranquilla (`python -m vigia_backend.seed`): 4 cámaras, trayectorias y ruido.
- Algoritmo puro de rutas (`vigia_backend.routing.reconstruct_routes`) con tests.
- Consulta `GET /api/v1/queries`: Haversine → detecciones → rutas candidatas (persistidas).
- Ingestión `POST /api/v1/ingest/detections`: Detection Envelope 1.1, eventos idempotentes y actualización de tracks repetidos.
- Credenciales individuales: emisión/revocación por CLI local o API admin, vigencia, hash y auditoría. [Guía operativa](../../docs/operations/device-credentials.md).
- Personas: contraseña `scrypt`, sesiones revocables, roles `operator`/`admin` y auditoría de consultas, exportaciones, previews y cambios. [Guía](../../docs/operations/user-access.md).
- Decisiones: [ADR-002](../../docs/adr/002-backend-central.md).

## Ejecutar localmente

```bash
cd apps/backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/macOS:
# source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m vigia_backend.migrate upgrade
python -m vigia_backend.seed
python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
python -m vigia_backend.device_credentials issue --camera CAM-01 --output .env.cam01-token
uvicorn vigia_backend.api:app --host 127.0.0.1 --port 8000
```

Abrir docs interactivas: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

Para una base MVP existente, usar [adopción con respaldo](../../docs/operations/database-migrations.md) en lugar de seed. El arranque ya no crea tablas automáticamente.

El ranking compara alternativas viales con pesos explícitos y conserva su geometría. Consulta [la fórmula y sus límites](../../docs/architecture/weighted-routes.md) y [cómo sincronizar OSRM](../../docs/operations/osrm-self-hosted.md).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Salud del servicio (pública) |
| POST | `/api/v1/auth/login`, `/api/v1/auth/logout` | Abrir / revocar sesión |
| GET | `/api/v1/auth/me` | Sesión actual |
| GET/POST | `/api/v1/devices` | Listar (operador) / crear (admin) |
| GET/PATCH/DELETE | `/api/v1/devices/{id}` | Leer (operador) / actualizar o borrar (admin) |
| GET/POST | `/api/v1/detections` | Listar (operador) / crear (admin) |
| GET/PATCH/DELETE | `/api/v1/detections/{id}` | Leer (operador) / actualizar o borrar (admin) |
| GET | `/api/v1/queries` | Consultar trayectorias estimadas (auditada) |
| POST | `/api/v1/queries/{id}/export` | Exportación en servidor (propia o admin; auditada) |
| GET | `/api/v1/admin/audit` | Auditoría (admin) |
| POST/DELETE | `/api/v1/admin/...credentials` | Credenciales de nodos (admin) |
| POST | `/api/v1/ingest/detections` | Recibir eventos 1.1 desde nodos edge (token de dispositivo) |
| POST | `/api/v1/ingest/thumbnails` | Recorte JPEG de un track ya publicado (token de dispositivo; 7 días) |
| POST | `/api/v1/ingest/heartbeat` | Latido del nodo: `running`, `paused` o `stopped`, con ritmo, cola, versión y batería (token de dispositivo) |
| GET | `/api/v1/detections/{id}/thumbnail` | Recorte (admin; cada vista auditada) |
| PUT/DELETE | `/api/v1/queries/{id}/confirmations/{detección}` | «¿Es este el vehículo?» (admin); recalcula las rutas |
| GET/PUT/DELETE | `/api/v1/detections/{id}/annotations[/{color\|plate}]` | Etiquetas de aprendizaje (admin, fase 4) |
| GET | `/api/v1/admin/annotations/summary` | Conteo de etiquetas por tarea (admin) |
| GET | `/api/v1/app/version` | Última versión de la app y mínima exigida (público) |

Salvo `/health` e ingestión, todo exige `Authorization: Bearer <token>`.

### Ejemplo de consulta

```text
GET /api/v1/queries?lat=11.012&lng=-74.816&radius_m=2000&time_from=2026-08-25T14:00:00Z&time_to=2026-08-25T16:00:00Z&vehicle_type=car&color=white
```

La respuesta incluye dispositivos cercanos, conteo de detecciones candidatas y **varias** rutas con `rank`, `confidence` y `has_distant_gaps`.

`thumbnail_url` en detecciones es la clave del recorte en el almacén privado, no una URL pública (`null` si no hay recorte). `GET /api/v1/devices` incluye `activity`: el estado real del nodo calculado con su latido (`liveness.py`). Herramientas de línea de comandos: `python -m vigia_backend.training_export` (dataset de aprendizaje), `python -m vigia_backend.users`, `python -m vigia_backend.devices` y `python -m vigia_backend.migrate`.

## Datos simulados

```bash
python -m vigia_backend.seed
```

Reescribe dispositivos, enlaces viales y detecciones con un escenario fijo (útil para probar el algoritmo de rutas).

## Tests

```bash
python -m pytest tests -v
```
