# VIGIA

Plataforma distribuida de vigilancia comunitaria para detectar vehículos y estimar trayectorias probables mediante una red colaborativa de cámaras y teléfonos.

**Estado documentado al 11 de octubre de 2026 · App móvil 1.1.0**

- [Consola del piloto en Azure](https://vigia-5dfe.mexicocentral.cloudapp.azure.com)
- [Descargar VIGÍA para Android](https://vigia-5dfe.mexicocentral.cloudapp.azure.com/descargar)
- [Configurar un teléfono como edge](./docs/operations/phone-edges.md)

## Resumen ejecutivo

Las cámaras residenciales y comunitarias suelen operar como sistemas aislados: producen grandes cantidades de video, pero consultar varias de ellas para reconstruir el recorrido de un vehículo es un proceso manual, lento y difícil de escalar. Centralizar permanentemente todos los videos también incrementa el consumo de red y los riesgos de privacidad.

VIGIA procesa el video en el edge y envía eventos de detección al backend central. Ante una consulta autorizada, la plataforma busca detecciones cercanas en espacio y tiempo y compara secuencias de cámaras con alternativas de la red vial. El resultado es una trayectoria estimada con un puntaje explicable; no demuestra la calle realmente recorrida ni constituye una identificación infalible.

El centro del piloto corre en una VM de Azure con HTTPS, PostgreSQL y OSRM. Se puede participar con un teléfono Android que detecta por sí mismo, o con un nodo Python que procesa una cámara RTSP, una webcam o el video de un teléfono. La consola web y la app Flutter permiten consultar las rutas. Los edges conservan una cola local y publican eventos idempotentes con credenciales individuales.

## Cómo funciona

```text
Teléfono Android ── cámara + YOLO26n/TFLite + tracker IoU ──┐
                                                        ├─ cola local + token ── HTTPS ──► Azure
Cámara RTSP / webcam / teléfono MJPEG ── nodo Python ──────┘                                 │
                                        YOLO + ByteTrack                          Caddy → FastAPI
                                                                                         │
                                                                               PostgreSQL + OSRM
                                                                                         │
                                                                                  Web / app móvil
```

En modo autónomo, el video permanece en el teléfono. En modo cámara, el video llega al PC que ejecuta el nodo de visión. La ingestión central recibe metadatos, no un flujo permanente de video. El preview del nodo Python es una función separada y necesita conectividad hacia ese nodo.

## Estado actual

| Componente | Estado |
|---|---|
| Centro en Azure | Piloto desde el 10/10: Caddy con HTTPS, backend, web, PostgreSQL 17 y OSRM en Docker |
| Consola web | Mapa de Barranquilla, filtros, rutas candidatas, historial de sesión, exportación auditada y demo explícita |
| App móvil Flutter 1.1 | Login, mapa, consultas, resultados y exportación; APK Android firmado; compilación iOS sin firma en CI, distribución pendiente |
| Edge autónomo Android | YOLO26n/TFLite a 320 px, tracker IoU, eventos cada 2 s y cola en disco; flujo teléfono → Azure verificado |
| Teléfono como cámara IP | MJPEG integrado por USB o red local con clave; el nodo Python realiza la detección |
| Nodo de visión Python | Tapo C110 por RTSP validada; webcam y HTTP/MJPEG; YOLO + ByteTrack y preview mediante API/proxy |
| Backend central | FastAPI + SQLAlchemy; PostgreSQL 17 en Compose, SQLite para desarrollo y pruebas |
| Ingestión edge→centro | Ambos tipos de edge publican Detection Envelope 1.1 con cola persistente y reintentos; el backend deduplica los eventos |
| Ruta sobre calles | OSRM propio, alternativas dirigidas y ranking ponderado; fallback visual explícito si falta geometría vial |
| Identidad de nodos | Tokens por cámara con caducidad, hash, rotación y revocación; alta desde la app con cuenta admin |
| Acceso de personas | Sesiones revocables, roles `operator`/`admin` y auditoría de consultas, exportaciones y cambios |
| Base de datos | Alembic `0001`–`0003`, respaldos y prueba de restauración; acceso administrativo por túnel SSH |
| Evaluación | 10 escenarios sintéticos; resiliencia con nodo simulado: 248/248 eventos, sin duplicados |
| VPN para sedes remotas | WireGuard preparado; pendiente validación entre redes. El piloto admite ingestión por HTTPS con token |

La [validación del edge autónomo](./docs/operations/phone-edges.md) registra, en un OPPO CPH2599, unos 6,2 análisis/s y una detección guardada en Azure. Es una medición de ese equipo y escenario. La [prueba de resiliencia del 08/10](./docs/evidence/p12-resiliencia-20261008.md) corresponde al nodo simulado sobre Compose; falta repetirla con cámara real en una sesión prolongada.

## Usar el piloto

### Consola web y móvil

Abre la [consola web](https://vigia-5dfe.mexicocentral.cloudapp.azure.com) o instala el [APK Android](https://vigia-5dfe.mexicocentral.cloudapp.azure.com/descargar). El APK de distribución viene configurado con el servidor del piloto. Si necesitas cambiarlo, usa el ícono de enlace del inicio de sesión o **Ajustes**:

```text
https://vigia-5dfe.mexicocentral.cloudapp.azure.com
```

Inicia sesión con una cuenta creada por el administrador; consulta [acceso de personas](./docs/operations/user-access.md). **Explorar demo** funciona con ejemplos locales, está identificado como demostración y no sustituye una consulta real fallida. Los horarios se muestran en hora de Colombia (UTC−5).

### Teléfono como edge autónomo, sin PC

1. En la app, inicia sesión como **admin** y abre **Cámaras → Agregar edge**.
2. Registra la ubicación real y elige **Este teléfono · detección integrada (sin PC)** como fuente.
3. Al emitir el token, toca **Usar en este teléfono** para verificarlo y guardarlo en el almacenamiento seguro.
4. Pulsa **Iniciar detección** y mantén la app abierta, con el teléfono conectado al cargador y orientado hacia la vía.

Si el administrador registra otro teléfono, en ese teléfono abre **Edge autónomo** desde el inicio de sesión e introduce el identificador, servidor y token emitidos. No necesita una sesión de operador para publicar detecciones.

La pantalla muestra detecciones, tiempo de inferencia y eventos enviados o pendientes. Sin red, conserva hasta 10 000 eventos en disco para reintentar. Si el sistema pausa la app, se detiene la detección; el procesamiento con la pantalla bloqueada sigue pendiente. Consulta [alta, operación y límites](./docs/operations/phone-edges.md).

### Cámara con nodo Python

Para una Tapo, webcam o teléfono en **Modo cámara**, ejecuta el nodo de visión en un PC cercano. Después de registrar el edge y emitir su token desde la app, puedes instalarlo así, desde la raíz del repositorio:

```bash
# Ejemplo: teléfono CEL-02 por USB, puerto local 8082.
bash infra/edges/install-node-token.sh CEL-02 8082 https://vigia-5dfe.mexicocentral.cloudapp.azure.com
bash infra/edges/run-phone-node.sh CEL-02
```

Usa el identificador de tu edge y prepara antes el entorno Python, la cámara y, para USB, ADB. El script solicita el token sin mostrarlo y lo verifica antes de guardarlo. Para RTSP, HTTP/MJPEG, webcam o red local, sigue la [guía de fuentes de video](./docs/operations/phone-edges.md#fuentes-de-video-admitidas) y la [guía de visión](./apps/vision/README.md).

## Estructura

```text
py_vigia/
├── apps/
│   ├── web/                 # Consola Next.js + MapLibre
│   ├── vision/              # Captura RTSP, YOLO, tracking y FastAPI
│   ├── backend/             # Plataforma central (FastAPI + SQLAlchemy + Alembic)
│   └── movil/               # Flutter: consola, cámara IP y edge autónomo
├── infra/
│   ├── azure/               # Despliegue, HTTPS y descarga del APK
│   ├── edges/               # Alta y ejecución de nodos Python
│   ├── osrm/                # Preparación del grafo vial
│   └── postgres/            # Respaldos y prueba de restauración
├── packages/
│   └── contracts/           # Esquemas compartidos y versionados
├── docs/
│   ├── architecture/        # Arquitectura vigente
│   ├── operations/          # Guías de operación y despliegue
│   ├── evidence/            # Resultados de validación
│   └── adr/                 # Registro de decisiones
├── PrimerInforme.md
└── compose.yaml
```

Consulta el [manual de arranque y validación](./docs/MANUAL_VALIDACION.md), el [roadmap priorizado](./docs/ROADMAP.md), la [arquitectura del sistema](./docs/architecture/overview.md) y la [decisión arquitectónica inicial](./docs/adr/001-hybrid-edge-architecture.md).

## Desarrollo local

El piloto compartido permite usar la web, la app y los edges sin levantar un backend por persona. Para desarrollar o probar en una base local, usa Docker Compose o los entornos individuales descritos abajo. Los comandos de esta sección parten de la raíz del repositorio, salvo que se indique otra carpeta.

### Backend, PostgreSQL y web con Docker Compose

Necesitas Docker con Compose v2 y OpenSSL. Define `VIGIA_DB_PASSWORD` en el `.env` de la raíz; para una instalación nueva, este bloque lo crea sin sobrescribir uno existente:

```bash
if [ ! -e .env ]; then
  (umask 077 && printf 'VIGIA_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env)
fi
docker compose up -d db
docker compose build backend web
docker compose run --rm backend python -m vigia_backend.migrate upgrade
docker compose run --rm backend python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
docker compose up -d backend web
```

Si el `.env` ya existe, comprueba que contenga una contraseña configurada. El comando de creación de usuario pide la contraseña por terminal. Abre la consola en [http://localhost:3000](http://localhost:3000); el backend queda en `http://127.0.0.1:8000`. En el equipo del proyecto, el Docker rootless se utiliza sustituyendo `docker compose` por `bash infra/docker-local.sh compose`.

Para una base MVP existente, sigue [adopción con respaldo](./docs/operations/database-migrations.md). El seed reescribe datos: úsalo únicamente en una base de desarrollo. La configuración de PostgreSQL y sus respaldos está en [esta guía](./docs/operations/postgres.md).

| Perfil adicional | Uso | Preparación |
|---|---|---|
| `vision` | Nodo de cámara Python | Configurar fuente y token en `apps/vision/.env` según la [guía de visión](./apps/vision/README.md) |
| `routing` | OSRM local | [Preparar el grafo y sincronizar alternativas de cámaras](./docs/operations/osrm-self-hosted.md) |
| `scoring` | Consola y base separadas para evaluación | [Crear y cargar el dataset sintético](./docs/operations/scoring-dataset.md) |
| `movil` | App Flutter en navegador, puerto 8095 | Compilar con `flutter build web` desde `apps/movil` |
| `resilience` | Backend aislado para pruebas de desconexión | [Procedimiento de resiliencia](./docs/operations/resilience.md) |

Activa los perfiles después de su preparación, por ejemplo: `docker compose --profile routing up -d`. Los puertos del stack local se publican en loopback.

### Nodo de visión sin Docker

```bash
cd apps/vision
python3 -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
# Solo la primera vez, si aún no existe .env:
cp -n .env.example .env
uvicorn vigia_vision.api:app --host 127.0.0.1 --port 8001
```

Configura primero la Tapo siguiendo la [guía del nodo de visión](./apps/vision/README.md). No publiques `.env` ni compartas la contraseña RTSP.

### Consola web sin Docker

Requiere Node.js 20.9 o superior. En otra terminal, desde la raíz:

```bash
cd apps/web
npm install
npm run dev
```

Configura `BACKEND_API_URL` en `apps/web/.env.local` si el backend no está en `http://127.0.0.1:8000`. Para ejecutarlo también sin Docker, consulta la [guía del backend](./apps/backend/README.md). El preview requiere `VISION_API_URL` accesible desde el servidor web. Para consultar el seed local, usa **Cargar escenario de prueba · 25 ago.**. Detén la web de Compose si ya ocupa el puerto 3000.

### App Flutter

El proyecto se verifica con Flutter 3.47.7. Desde la raíz:

```bash
cd apps/movil
flutter pub get
flutter devices
flutter run -d <id> --dart-define=VIGIA_DEFAULT_API=https://vigia-5dfe.mexicocentral.cloudapp.azure.com
```

Sustituye `<id>` por un dispositivo listado. Para conectar con el backend local desde emulador o USB, compilar el APK y gestionar la firma, consulta el [README móvil](./apps/movil/README.md). El workflow [movil.yml](./.github/workflows/movil.yml) ejecuta análisis, pruebas y compilaciones Android/iOS; el APK de CI usa firma de depuración y el artefacto iOS no está firmado.

## Operación en Azure y acceso a la base

La [guía de Azure](./docs/operations/azure.md) describe despliegue, actualización, SSH y respaldos. Las imágenes se construyen en el PC y se suben con `infra/azure/deploy.sh`. Caddy publica la web y el API por HTTPS; PostgreSQL escucha en `127.0.0.1:5432` de la VM. El acceso SSH está restringido a la IP del administrador.

### DBeaver mediante túnel SSH

Crea una conexión **PostgreSQL** y configura estos campos:

| Pestaña | Campo | Valor |
|---|---|---|
| Principal | Host / puerto | `127.0.0.1` / `5432` |
| Principal | Base de datos / usuario | `vigia` / `vigia` |
| Principal | Contraseña | `VIGIA_DB_PASSWORD` del archivo `/opt/vigia/.env` **del servidor** |
| SSH | Usar túnel SSH | Activado |
| SSH | Host / puerto | `vigia-5dfe.mexicocentral.cloudapp.azure.com` / `22` |
| SSH | Usuario | `vigia` |
| SSH | Autenticación | Llave pública; selecciona tu archivo de llave privada autorizado (en el equipo del proyecto: `~/.ssh/vigia_azure`) |

El administrador puede consultar la contraseña dentro de una sesión SSH en la VM. Es distinta de las credenciales de personas de VIGIA y se genera durante el despliegue; no uses el `.env` local. En esta configuración, el transporte hasta la VM se cifra con SSH y no se configura SSL adicional en PostgreSQL. Prueba el túnel y luego la conexión. No hace falta abrir el puerto 5432 en el firewall de Azure. Si cambia tu IP pública, sigue la [guía para restablecer el acceso SSH](./docs/operations/azure.md#si-cambia-tu-ip-ssh-bloqueado).

## Límites y próximos pasos

- **Detección:** los modelos actuales detectan automóviles y motocicletas. La vista cenital nocturna mostró limitaciones; falta afinar y evaluar con datos propios. Color, marca, modelo y texto de placa no se infieren todavía.
- **Placas:** el nodo Python admite un detector especializado opcional y recortes locales; OCR e integración de placas en el edge autónomo siguen pendientes.
- **Operación móvil:** falta detección/transmisión con pantalla bloqueada, aceleración GPU/NNAPI y distribución firmada para iPhone.
- **Evaluación:** falta validar rutas con recorridos independientes, repetir resiliencia con cámara real y medir carga con 4/10/25 nodos. Los puntajes no son probabilidades calibradas.
- **Infraestructura:** quedan la validación de WireGuard entre redes, actualización con rollback automático, límite de peticiones por IP y copia de respaldos fuera de la VM.
- **Evoluciones:** PostGIS y MQTT permanecen en espera; consulta el [roadmap](./docs/ROADMAP.md) y las guías operativas para el detalle de cada frente.

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
- [Servidor central en Azure](./docs/operations/azure.md) · [teléfonos como edges](./docs/operations/phone-edges.md)
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
- [App móvil: desarrollo, firma y distribución](./apps/movil/README.md)
- [Contratos compartidos](./packages/contracts/README.md)

## Equipo

| Nombre | GitHub |
|---|---|
| Cristian Vizcaíno | [@cfvizcaino](https://github.com/cfvizcaino) |
| Juan Delgado | [@Deelgado](https://github.com/Deelgado) |
| Daniel Castañeda | [@DanielCM21](https://github.com/DanielCM21) |

**Tutores:** Augusto Salazar y Diana Roca.
