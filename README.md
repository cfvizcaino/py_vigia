# VIGIA

Plataforma distribuida de vigilancia comunitaria para detectar vehículos y estimar trayectorias probables mediante una red colaborativa de cámaras.

## Resumen ejecutivo

Las cámaras residenciales y comunitarias suelen operar como sistemas aislados: producen grandes cantidades de video, pero consultar varias de ellas para reconstruir el recorrido de un vehículo es un proceso manual, lento y difícil de escalar. Centralizar permanentemente todos los videos también incrementa el consumo de red y los riesgos de privacidad.

VIGIA propone que cada dispositivo procese el video localmente y registre únicamente detecciones vehiculares relevantes. Ante una consulta autorizada, la plataforma seleccionará los dispositivos cercanos, consolidará sus respuestas y construirá una trayectoria aproximada utilizando ubicación, tiempo, dirección y similitud visual. El resultado se presentará como una estimación con nivel de confianza, no como una identificación infalible.

El prototipo actual conecta una cámara física Tapo C110 mediante RTSP, detecta automóviles y motocicletas con YOLO y ByteTrack, publica los resultados a través de un servicio local y permite supervisar la cámara desde una consola web con mapa. La arquitectura protege las credenciales RTSP y está preparada para incorporar posteriormente un backend central, PostgreSQL/PostGIS, autenticación y mensajería MQTT.

## Estado actual

| Componente | Estado |
|---|---|
| Consola web y mapa de Barranquilla | Funcional con dispositivos simulados |
| Tapo C110 | Conexión RTSP validada |
| Detección y tracking | Línea base funcional con YOLO + ByteTrack |
| Preview seguro en la web | Implementado mediante API y proxy |
| Backend central, PostGIS y MQTT | Próximo hito |
| Reconstrucción real de trayectorias | Pendiente de múltiples cámaras/datos |

## Estructura

```text
py_vigia/
├── apps/
│   ├── web/                 # Consola Next.js + MapLibre
│   └── vision/              # Captura RTSP, YOLO, tracking y FastAPI
├── packages/
│   └── contracts/           # Esquemas compartidos y versionados
├── docs/
│   ├── architecture/        # Arquitectura vigente
│   └── adr/                 # Registro de decisiones
├── PrimerInforme.md
└── compose.yaml
```

Consulta la [arquitectura del sistema](./docs/architecture/overview.md) y la [decisión arquitectónica inicial](./docs/adr/001-hybrid-edge-architecture.md).

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

### Docker

```bash
docker compose --profile vision up --build
```

Docker permitirá levantar web y visión de forma reproducible. El compose crecerá con backend, PostGIS y MQTT cuando esos componentes sean necesarios.

## Documentación

- [Primer informe](./PrimerInforme.md)
- [Arquitectura](./docs/architecture/overview.md)
- [Estrategia de detección de placas](./docs/modeling/license-plates.md)
- [Nodo de visión](./apps/vision/README.md)
- [Consola web](./apps/web/README.md)
- [Contratos compartidos](./packages/contracts/README.md)

## Equipo

| Nombre | GitHub |
|---|---|
| Cristian Vizcaíno | [@cfvizcaino](https://github.com/cfvizcaino) |
| Juan Delgado | [@Deelgado](https://github.com/Deelgado) |
| Daniel Castañeda | [@DanielCM21](https://github.com/DanielCM21) |

**Tutores:** Augusto Salazar y Diana Roca.
