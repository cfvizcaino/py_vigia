# Manual de arranque y validación de VIGIA

Este manual cubre P0.1–P0.3 y los primeros incrementos de P0.4: credenciales individuales y migraciones versionadas. El flujo esperado es cámara Tapo → nodo de visión → cola persistente → backend central → consulta ponderada → ruta ajustada a calles → consola web.

Para probar directamente el entorno separado dejado en este equipo, ver [sesión local P0.4, servicios y reinicio](./operations/p04-validation-session.md).

## 1. Requisitos

- Git.
- Python 3.12 y `uv` o `venv` + `pip`.
- Node.js 20.9 o superior y npm.
- FFmpeg/ffprobe para diagnosticar RTSP.
- Una cuenta de cámara creada en la aplicación Tapo.
- Docker Compose, solo si se usará el arranque en contenedores.
- Acceso a Internet para descargar dependencias, el peso YOLO inicial y el extracto OSM para el enrutador propio.

Comprueba las herramientas:

```bash
git --version
python3.12 --version
uv --version
node --version
npm --version
ffprobe -version
```

No confirmes en Git archivos `.env`, bases SQLite, videos, capturas, datasets, pesos, `outputs/`, `output/`, `.next/`, `node_modules/` ni resultados de pruebas. Ya están cubiertos por los `.gitignore` del proyecto.

## 2. Arranque local recomendado

Ejecuta cada componente en una terminal distinta desde la raíz del repositorio.

### Terminal 1: backend central

```bash
cd apps/backend
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install -r requirements.txt
cp .env.example .env
python -m vigia_backend.migrate upgrade
python -m vigia_backend.seed
python -m vigia_backend.device_credentials issue --camera CAM-01 --output .env.cam01-token
uvicorn vigia_backend.api:app --host 127.0.0.1 --port 8000
```

Conserva `INGEST_AUTH_MODE=device` en `apps/backend/.env`. El comando de credenciales escribe el secreto en `.env.cam01-token` (0600); incorpora ese valor en el `.env` de visión. No repitas el seed después de emitirlo: el seed reinicia la base configurada en `DATABASE_URL` e invalida credenciales de los dispositivos recreados. No lo ejecutes sobre datos que necesites conservar. Si ya tienes entornos o `.env`, actualízalos sin sobrescribir tu configuración.

Resultado esperado:

```bash
curl -fsS http://127.0.0.1:8000/health | python3 -m json.tool
```

Debe responder con `"service": "vigia-backend"` y `"status": "ok"`. La documentación interactiva queda en <http://127.0.0.1:8000/docs>.

### Terminal 2: nodo de visión

```bash
cd apps/vision
uv venv --python 3.12 .venv
source .venv/bin/activate
uv pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
uv pip install -r requirements.txt
cp .env.example .env
```

Edita `apps/vision/.env`:

```dotenv
TAPO_HOST=IP_LOCAL_DE_LA_CAMARA
TAPO_USERNAME=CUENTA_DE_CAMARA
TAPO_PASSWORD=CONTRASENA_DE_CAMARA
TAPO_STREAM=stream1
VIGIA_CAMERA_ID=CAM-01
VIGIA_CENTRAL_API_URL=http://127.0.0.1:8000
VIGIA_CENTRAL_API_TOKEN=TOKEN_INDIVIDUAL_EMITIDO_PARA_CAM01
```

Luego inicia el servicio:

```bash
uvicorn vigia_vision.api:app --host 127.0.0.1 --port 8001
```

Comprueba el estado:

```bash
curl -fsS http://127.0.0.1:8001/api/v1/status | python3 -m json.tool
curl -fsS http://127.0.0.1:8001/api/v1/preview.jpg -o /tmp/vigia-preview.jpg
file /tmp/vigia-preview.jpg
```

Tras cargar el modelo y conectar la cámara, se espera:

- `status` igual a `running`;
- `frameNumber` creciente y `processingFps` mayor que cero;
- `errorCode` nulo;
- `publisher.enabled` igual a `true`;
- `publisher.pendingEvents` vuelve a cero;
- `publisher.lastDeliveredAt` deja de ser nulo;
- `/tmp/vigia-preview.jpg` es una imagen JPEG válida.

`stream1` ofrece más detalle; `stream2` reduce ancho de banda. OpenCV está limitado a una versión menor que 5 porque la versión 5 no abrió de forma fiable el RTSP/FFmpeg de la Tapo validada.

### Terminal 3: consola web

```bash
cd apps/web
npm ci
cp .env.example .env.local
npm run dev
```

Abre <http://127.0.0.1:3000>. Las URL por defecto de `.env.example` ya apuntan a los dos servicios locales.

## 3. Validación funcional

### 3.1 Consola y consulta central

1. Confirma que la barra superior muestre el servicio central conectado.
2. Pulsa **Cargar escenario de prueba · 25 ago.**
3. Conserva automóvil blanco, radio de 2 km y horario 09:20–10:30 de Colombia.
4. Ejecuta la búsqueda.

Con el seed hay cinco detecciones candidatas en esa ventana. El número y ranking de rutas dependen de los enlaces sincronizados: los tiempos sintéticos originales no se recalibran silenciosamente para encajar con el mapa real. Debe aparecer CAM-01→CAM-02 y un puntaje explicable; no exigir dos rutas fijas. Abrir **¿Por qué aparece esta ruta?** para ver pesos, tiempo observado/referencia y penalizaciones. El puntaje no es una probabilidad de identidad.

Selecciona cada ruta y verifica que:

- el mapa encuadre la secuencia de cámaras;
- el pie indique **Geometría vial OSRM** y una distancia cuando el enrutador responda;
- la línea siga las calles, en vez de unir las cámaras con una recta;
- con enlaces sincronizados, el pie diga **alternativa evaluada** y use la geometría persistida incluso si OSRM se detiene; sin ellos, diga **solo referencia visual**, o fallback discontinuo si el enrutador tampoco responde;
- la exportación JSON y el historial de la sesión funcionen.

OSRM puede usarse en producción autogestionado sin cobro por consulta. Sigue [la receta local](./operations/osrm-self-hosted.md): preparar el extracto, procesarlo e iniciar el perfil `routing`. La web usa `http://127.0.0.1:5000` localmente y `http://osrm:5000` en Compose. Sin ese servicio se verá el fallback identificado. El demo público no es una dependencia de producción.

Luego sincroniza las cámaras desde el backend:

```bash
python -m vigia_backend.road_network --camera CAM-01 --camera CAM-02 --camera CAM-03 --camera CAM-04
```

Para una base existente sin Alembic, **antes de arrancar** seguir [adopción con respaldo](./operations/database-migrations.md); no ejecutar seed. La [explicación técnica del ranking](./architecture/weighted-routes.md) incluye una prueba donde gana una ruta más larga.

### 3.2 Cámara y publicación edge→centro

En la vista de cámaras selecciona `CAM-01` y abre el preview. Debe verse el frame procesado sin exponer la URL RTSP en el navegador.

Mientras la cámara esté activa, consulta varias veces:

```bash
curl -fsS http://127.0.0.1:8001/api/v1/status | python3 -m json.tool
```

La cola puede crecer transitoriamente, pero debe regresar a cero. El backend acepta una sola vez cada `eventId` y actualiza una observación lógica del mismo track, por lo que los reintentos no deben duplicar vehículos.

### 3.3 Recuperación ante una caída

1. Detén el backend con `Ctrl+C`, pero deja visión procesando durante al menos 30 segundos.
2. Comprueba que `publisher.pendingEvents` crezca y `publisher.lastError` reporte el fallo de transporte.
3. Reinicia el backend sin ejecutar de nuevo el seed.
4. Espera el reintento exponencial, con un máximo de 60 segundos entre intentos.

La aceptación es que la cola vuelva a cero, `lastDeliveredAt` se actualice y el servicio de visión continúe en `running`. Para cerrar P0.2/P1.2 en campo, repite la prueba con un corte real de cinco minutos y conserva las mediciones.

### 3.4 Sede remota mediante VPN

La cámara y el edge permanecen juntos en la LAN remota; solo el edge entra a WireGuard autogestionado. No se requiere una suscripción por cámara. La conectividad entrante del centro está por confirmar.

Sigue [la guía de VPN](./operations/remote-camera-vpn.md) y valida desde el edge:

```bash
sudo wg show wg-vigia latest-handshakes
curl --max-time 5 -fsS http://10.77.0.1:8443/health
curl --max-time 5 -i http://10.77.0.1:8443/api/v1/devices
```

Esperado: handshake reciente, salud 200 y CRUD 404. El proxy del centro solo admite ingestión/salud dentro del túnel cifrado. El firewall descarta edge→edge; preview remoto no se habilita por defecto. Sigue la guía para instalación, persistencia y comprobaciones de aislamiento.

## 4. Arranque con Docker Compose

Crea primero los dos `.env` y completa las credenciales como en el arranque local. Después:

```bash
docker compose build backend
docker compose run --rm backend python -m vigia_backend.migrate upgrade
docker compose up --build -d backend web
docker compose exec backend python -m vigia_backend.seed
docker compose exec backend python -m vigia_backend.device_credentials issue --camera CAM-01 --output /app/data/.env.cam01-token
docker compose cp backend:/app/data/.env.cam01-token apps/vision/.env.cam01-token
chmod 600 apps/vision/.env.cam01-token
# Incorporar el token emitido en apps/vision/.env antes del siguiente comando.
docker compose --profile vision up --build -d vision
docker compose ps
```

Para ver registros:

```bash
docker compose logs -f backend web vision
```

Para detener los servicios sin borrar la base:

```bash
docker compose --profile vision down
```

No agregues `-v` salvo que quieras eliminar deliberadamente el volumen de la base de desarrollo.

## 5. Pruebas automatizadas

Backend:

```bash
cd apps/backend
source .venv/bin/activate
python -m pytest tests -v
```

Visión:

```bash
cd apps/vision
source .venv/bin/activate
python -m unittest discover -s tests -v
```

Configuración VPN (desde la raíz, no modifica interfaces ni firewall):

```bash
python3 -m unittest discover -s infra/wireguard -p 'test_*.py' -v
```

Web:

```bash
cd apps/web
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Antes de publicar una rama, ejecuta desde la raíz:

```bash
git diff --check
git status --short
```

`git status` no debe mostrar secretos ni artefactos generados.

## 6. Diagnóstico rápido

Si la cámara no abre, verifica que el puerto sea alcanzable y prueba RTSP directamente. Evita copiar el comando o su salida en tickets porque contiene credenciales:

```bash
ffprobe -rtsp_transport tcp 'rtsp://USUARIO:CONTRASENA@IP:554/stream1'
```

- `CAMERA_UNAVAILABLE`: IP, cuenta de cámara, contraseña, puerto 554 o conectividad LAN incorrectos.
- `MODEL_LOAD_ERROR`: peso ausente/incompatible o fallo durante la descarga inicial.
- `DEPENDENCY_ERROR`: entorno virtual incompleto.
- `PROCESSING_ERROR`: revisa el log del nodo; suele ser decodificación o inferencia.
- `publisher.pendingEvents` no baja: verifica URL central, token individual, VPN y `/health` del backend.
- HTTP 401 al ingerir: token ausente, desconocido, revocado o vencido; emite/instala uno válido.
- HTTP 403 al ingerir: el token pertenece a una cámara distinta de `VIGIA_CAMERA_ID`.
- HTTP 404 al ingerir: el `VIGIA_CAMERA_ID` no existe en el backend; ejecuta el seed o registra el dispositivo.
- Ruta recta discontinua: OSRM no respondió; revisa `ROAD_ROUTER_URL` y la conectividad saliente.

## 7. Salida y continuidad de P0.4

P0.1–P0.3 quedan listos en código cuando todas estas casillas están verificadas:

- backend, visión y web saludables;
- evento real entregado con cola en cero y sin duplicados;
- corte y recuperación observados;
- sede remota validada sin exponer RTSP;
- ruta vial y fallback explícito comprobados;
- suites automatizadas en verde;
- secretos y artefactos fuera de Git.

La validación física prolongada de VPN/cámara sigue pendiente de evidencia de campo. P0.4 incorpora tokens revocables, auditoría de credenciales y migraciones Alembic con respaldo. Continúa con usuarios, roles `operator`/`admin` y protección/auditoría de consultas, preview y exportaciones.
