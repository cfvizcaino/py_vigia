# Manual de arranque y validación de VIGIA

Este manual deja reproducible el incremento P0.1–P0.3 antes de comenzar P0.4. El flujo esperado es cámara Tapo → nodo de visión → cola persistente → backend central → consulta → ruta ajustada a calles → consola web.

## 1. Requisitos

- Git.
- Python 3.12 y `uv` o `venv` + `pip`.
- Node.js 20.9 o superior y npm.
- FFmpeg/ffprobe para diagnosticar RTSP.
- Una cuenta de cámara creada en la aplicación Tapo.
- Docker Compose, solo si se usará el arranque en contenedores.
- Acceso a Internet para descargar dependencias, el peso YOLO inicial y consultar el OSRM público de desarrollo.

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
python -m vigia_backend.seed
uvicorn vigia_backend.api:app --host 127.0.0.1 --port 8000
```

En `apps/backend/.env`, reemplaza `INGEST_API_TOKEN` por un secreto largo de desarrollo. El seed reinicia exclusivamente la base configurada en `DATABASE_URL`; no lo ejecutes sobre datos que necesites conservar.

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
VIGIA_CENTRAL_API_TOKEN=EL_MISMO_TOKEN_DEL_BACKEND
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

Con el seed actual deben aparecer 5 detecciones candidatas y 2 rutas. La primera conecta `CAM-01` con `CAM-02`; la otra conecta `CAM-03` con `CAM-04`. Los porcentajes son confianza del algoritmo, no una identificación inequívoca.

Selecciona cada ruta y verifica que:

- el mapa encuadre la secuencia de cámaras;
- el pie indique **Geometría vial OSRM** y una distancia cuando el enrutador responda;
- la línea siga las calles, en vez de unir las cámaras con una recta;
- si OSRM no está disponible, aparezca **Estimación directa; enrutador vial no disponible** y la línea sea discontinua;
- la exportación JSON y el historial de la sesión funcionen.

El OSRM público es solo para desarrollo. Antes de un piloto debe configurarse `ROAD_ROUTER_URL` con una instancia propia o un proveedor con SLA.

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

La cámara y el edge permanecen juntos en la LAN remota; solo el edge entra a la VPN. No expongas RTSP/554 ni uses Tailscale Funnel.

Sigue [la guía de VPN](./operations/remote-camera-vpn.md) y valida desde el edge:

```bash
tailscale status
tailscale ping vigia-central
curl -fsS https://vigia-central.NOMBRE-TAILNET.ts.net/health
```

El nodo debe publicar por el nombre MagicDNS del centro. La política incluida permite edge→centro en HTTPS, niega edge→edge y reserva la administración al grupo autorizado.

## 4. Arranque con Docker Compose

Crea primero los dos `.env` y completa las credenciales como en el arranque local. Después:

```bash
docker compose up --build -d backend web
docker compose exec backend python -m vigia_backend.seed
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
- `publisher.pendingEvents` no baja: verifica URL central, token compartido, VPN y `/health` del backend.
- HTTP 401 al ingerir: `VIGIA_CENTRAL_API_TOKEN` e `INGEST_API_TOKEN` no coinciden.
- HTTP 404 al ingerir: el `VIGIA_CAMERA_ID` no existe en el backend; ejecuta el seed o registra el dispositivo.
- Ruta recta discontinua: OSRM no respondió; revisa `ROAD_ROUTER_URL` y la conectividad saliente.

## 7. Salida para comenzar P0.4

P0.1–P0.3 quedan listos en código cuando todas estas casillas están verificadas:

- backend, visión y web saludables;
- evento real entregado con cola en cero y sin duplicados;
- corte y recuperación observados;
- sede remota validada sin exponer RTSP;
- ruta vial y fallback explícito comprobados;
- suites automatizadas en verde;
- secretos y artefactos fuera de Git.

La validación física prolongada de VPN/cámara sigue siendo evidencia de campo, no una condición que pueda sustituirse con tests locales. Cumplido lo anterior, P0.4 comienza con migraciones, usuarios, roles `operator`/`admin`, protección de consultas/preview/exportaciones, auditoría y tokens revocables por nodo.
