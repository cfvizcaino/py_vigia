# Backend central de VIGIA

Monolito modular (ADR-001) con FastAPI + SQLAlchemy. Persistencia inicial en SQLite.
Modelo alineado con [docs/architecture/data-model.md](../../docs/architecture/data-model.md).

## Alcance actual

- Tablas: `users`, `devices`, `device_links`, `detections`, `queries`, `route_results`, `route_result_detections`.
- CRUD HTTP de `devices` y `detections`.
- Seed Barranquilla (`python -m vigia_backend.seed`): 4 cámaras, trayectorias y ruido.
- Algoritmo puro de rutas (`vigia_backend.routing.reconstruct_routes`) con tests.
- Consulta `GET /api/v1/queries`: Haversine → detecciones → rutas candidatas (persistidas).
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
python -m vigia_backend.seed
uvicorn vigia_backend.api:app --host 127.0.0.1 --port 8000
```

Abrir docs interactivas: [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs).

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Salud del servicio |
| GET/POST | `/api/v1/devices` | Listar / crear dispositivo |
| GET/PATCH/DELETE | `/api/v1/devices/{id}` | Leer / actualizar / borrar |
| GET/POST | `/api/v1/detections` | Listar (filtros opcionales) / crear |
| GET/PATCH/DELETE | `/api/v1/detections/{id}` | Leer / actualizar / borrar |
| GET | `/api/v1/queries` | Consultar trayectorias estimadas |

### Ejemplo de consulta

```text
GET /api/v1/queries?lat=11.012&lng=-74.816&radius_m=2000&time_from=2026-08-25T14:00:00Z&time_to=2026-08-25T16:00:00Z&vehicle_type=car&color=white
```

La respuesta incluye dispositivos cercanos, conteo de detecciones candidatas y **varias** rutas con `rank`, `confidence` y `has_distant_gaps`.

`thumbnail_url` en detecciones es opcional (`null` por defecto).

## Datos simulados

```bash
python -m vigia_backend.seed
```

Reescribe dispositivos, enlaces viales y detecciones con un escenario fijo (útil para probar el algoritmo de rutas).

## Tests

```bash
python -m pytest tests -v
```
