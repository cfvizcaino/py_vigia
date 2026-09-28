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
| Backend central (CRUD + consultas de rutas) | Funcional en `apps/backend` (SQLite; seed Barranquilla) |
| Ingestión edge→centro | Detection Envelope 1.1, cola persistente y deduplicación |
| Ruta sobre calles | OSRM configurable con fallback identificado |
| VPN para sedes remotas | Diseño Tailscale/WireGuard y política de mínimo privilegio documentados |
| PostGIS y MQTT | Próximo hito |
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

Abre [http://localhost:3000](http://localhost:3000), selecciona `CAM-01` y revisa la vista procesada.

La consola consulta el backend en `http://127.0.0.1:8000`; puedes configurar
`BACKEND_API_URL` en `apps/web/.env.local`. Inícialo siguiendo la
[guía del backend](./apps/backend/README.md). Si está desconectado, **Explorar demo**
habilita un escenario local identificado como demostración. Para consultar el seed
del backend, usa **Cargar escenario de prueba · 25 ago.** y luego busca coincidencias.
Las horas de la consola corresponden a Colombia (UTC−5).

### Docker

```bash
docker compose --profile vision up --build
```

Compose levanta backend y web; el perfil `vision` añade el nodo de cámara. Después del primer arranque, carga el escenario de desarrollo con `docker compose exec backend python -m vigia_backend.seed`. PostGIS y MQTT permanecen fuera hasta cerrar los hitos P0/P1.

## Documentación

- [Primer informe](./PrimerInforme.md)
- [Segundo informe](./SegundoInforme.md)
- [Manual de arranque y validación](./docs/MANUAL_VALIDACION.md)
- [Roadmap priorizado](./docs/ROADMAP.md)
- [VPN para cámaras remotas](./docs/operations/remote-camera-vpn.md)
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
