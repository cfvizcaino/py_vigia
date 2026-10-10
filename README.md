# VIGIA

Plataforma distribuida de vigilancia comunitaria para detectar vehículos y estimar trayectorias probables mediante una red colaborativa de cámaras.

## Resumen ejecutivo

Las cámaras residenciales y comunitarias suelen operar como sistemas aislados: producen grandes cantidades de video, pero consultar varias de ellas para reconstruir el recorrido de un vehículo es un proceso manual, lento y difícil de escalar. Centralizar permanentemente todos los videos también incrementa el consumo de red y los riesgos de privacidad.

VIGIA propone que cada dispositivo procese el video localmente y registre únicamente detecciones vehiculares relevantes. Ante una consulta autorizada, la plataforma seleccionará los dispositivos cercanos, consolidará sus respuestas y construirá una trayectoria aproximada utilizando ubicación, tiempo, dirección y similitud visual. El resultado se presentará como una estimación con nivel de confianza, no como una identificación infalible.

El prototipo actual conecta una cámara física Tapo C110 mediante RTSP, detecta automóviles y motocicletas con YOLO y ByteTrack, conserva una cola local y publica eventos idempotentes al backend central. La consola representa rutas candidatas sobre geometría vial OSRM y conserva un fallback explícito cuando el enrutador no está disponible. Las cámaras remotas se conectan mediante un nodo edge dentro de una VPN, sin exponer RTSP.

## Estado actual

| Componente | Estado |
|---|---|
| Consola web y mapa de Barranquilla | Consola adaptable con dispositivos del API y demostración explícita |
| Tapo C110 | Conexión RTSP validada |
| Detección y tracking | Línea base funcional con YOLO + ByteTrack |
| Preview seguro en la web | Implementado mediante API y proxy |
| Backend central (CRUD + consultas de rutas) | Funcional en `apps/backend`; PostgreSQL 17 en Compose, SQLite para desarrollo y pruebas |
| Dataset de puntajes | 10 escenarios sintéticos con verdad de terreno y evaluador recall@k / enlaces falsos |
| Ingestión edge→centro | Detection Envelope 1.1, cola persistente y deduplicación |
| Ruta sobre calles | OSRM propio probado en Docker; alternativas dirigidas y ranking ponderado explicable |
| VPN para sedes remotas | WireGuard autogestionado, generador e aislamiento; pendiente validación entre redes |
| Identidad de nodos | Tokens por cámara con caducidad, revocación y hash; emisión por CLI o API admin |
| Acceso de personas | Login, sesiones revocables, roles `operator`/`admin` en backend y auditoría de uso |
| Migraciones de base | Alembic `0001`–`0003` con adopción validada y respaldo del MVP |
| PostGIS y MQTT | En espera (P2) |
| Integración web con API central | Dispositivos, filtros, rutas candidatas, historial de sesión y exportación JSON |

## Estructura

```text
py_vigia/
├── apps/
│   ├── web/                 # Consola Next.js + MapLibre
│   ├── vision/              # Captura RTSP, YOLO, tracking y FastAPI
│   └── backend/             # Plataforma central modular (FastAPI + SQL)
├── packages/
│   └── contracts/           # Esquemas compartidos y versionados
├── docs/
│   ├── architecture/        # Arquitectura vigente
│   └── adr/                 # Registro de decisiones
├── PrimerInforme.md
└── compose.yaml
```

Consulta el [manual de arranque y validación](./docs/MANUAL_VALIDACION.md), el [roadmap priorizado](./docs/ROADMAP.md), la [arquitectura del sistema](./docs/architecture/overview.md) y la [decisión arquitectónica inicial](./docs/adr/001-hybrid-edge-architecture.md).

## Inicio rápido

### 1. Nodo de visión

```bash
cd apps/vision
python3 -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env
uvicorn vigia_vision.api:app --host 127.0.0.1 --port 8001
```

Configura primero la Tapo siguiendo la [guía del nodo de visión](./apps/vision/README.md). No publiques `.env` ni compartas la contraseña RTSP.

### 2. Consola web

En otra terminal:

```bash
cd apps/web
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000), inicia sesión con una cuenta creada por CLI ([acceso de personas](./docs/operations/user-access.md)), selecciona `CAM-01` y revisa la vista procesada. **Explorar demo** funciona sin sesión y sin contactar el servicio central.

La consola consulta el backend en `http://127.0.0.1:8000`; puedes configurar
`BACKEND_API_URL` en `apps/web/.env.local`. Inícialo siguiendo la
[guía del backend](./apps/backend/README.md). Si está desconectado, **Explorar demo**
habilita un escenario local identificado como demostración. Para consultar el seed
del backend, usa **Cargar escenario de prueba · 25 ago.** y luego busca coincidencias.
Las horas de la consola corresponden a Colombia (UTC−5).

### Docker

```bash
(umask 077 && printf 'VIGIA_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env)
docker compose up -d db
docker compose build backend web
docker compose run --rm backend python -m vigia_backend.migrate upgrade
docker compose run --rm backend python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
docker compose --profile vision up --build
```

Compose levanta PostgreSQL ([guía y respaldos](./docs/operations/postgres.md)), backend y web; el perfil `vision` añade el nodo de cámara. Si ya existe una base MVP, utiliza [adopción con respaldo](./docs/operations/database-migrations.md) en vez de upgrade directo. Solo para una base nueva de prueba, carga el seed y emite la [credencial del nodo](./docs/operations/device-credentials.md). El perfil `routing` añade [OSRM propio](./docs/operations/osrm-self-hosted.md); después sincroniza las alternativas de las cámaras. El [ranking ponderado](./docs/architecture/weighted-routes.md) devuelve su explicación y geometría. Los puertos se configuran en loopback; verificar también los sockets efectivos del host. PostGIS y MQTT permanecen fuera hasta cerrar P0/P1. El perfil `scoring` levanta una consola aparte con el [dataset sintético de puntajes](./docs/operations/scoring-dataset.md).

## Documentación

- [Primer informe](./PrimerInforme.md)
- [Segundo informe](./SegundoInforme.md)
- [Manual de arranque y validación](./docs/MANUAL_VALIDACION.md)
- [Roadmap priorizado](./docs/ROADMAP.md)
- [VPN para cámaras remotas](./docs/operations/remote-camera-vpn.md)
- [OSRM propio sin cobro por consulta](./docs/operations/osrm-self-hosted.md)
- [Credenciales individuales de nodos](./docs/operations/device-credentials.md)
- [Acceso de personas, roles y auditoría](./docs/operations/user-access.md)
- [PostgreSQL, respaldos y restauración](./docs/operations/postgres.md)
- [Dataset sintético de puntajes y rutas](./docs/operations/scoring-dataset.md)
- [Prueba de resiliencia P1.2](./docs/operations/resilience.md) · [evidencia 08/10/2026](./docs/evidence/p12-resiliencia-20261008.md)
- [Arquitectura](./docs/architecture/overview.md)
- [ADR-001: arquitectura híbrida](./docs/adr/001-hybrid-edge-architecture.md)
- [ADR-002: backend central y rutas](./docs/adr/002-backend-central.md)
- [Modelo de datos](./docs/architecture/data-model.md)
- [Estrategia de detección de placas](./docs/modeling/license-plates.md)
- [Nodo de visión](./apps/vision/README.md)
- [Consola web](./apps/web/README.md)
- [Backend central](./apps/backend/README.md)
- [Contratos compartidos](./packages/contracts/README.md)

## Equipo

| Nombre | GitHub |
|---|---|
| Cristian Vizcaíno | [@cfvizcaino](https://github.com/cfvizcaino) |
| Juan Delgado | [@Deelgado](https://github.com/Deelgado) |
| Daniel Castañeda | [@DanielCM21](https://github.com/DanielCM21) |

**Tutores:** Augusto Salazar y Diana Roca.
