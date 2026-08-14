# Nodo de visión de VIGIA

Este componente recibe un video, una webcam o el flujo RTSP de una cámara Tapo, ejecuta detección y tracking de automóviles y motocicletas y expone una API local segura para la consola web. El navegador nunca recibe la URL RTSP ni las credenciales. La vista web utiliza MJPEG para entregar continuamente los frames ya procesados.

## Configurar la Tapo C110

1. Conecta la cámara y el computador a la misma red local.
2. En la aplicación Tapo, crea una **cuenta de cámara** para RTSP/ONVIF. No es necesariamente la misma cuenta de TP-Link.
3. Consulta en el router la IP local asignada a la cámara y, de ser posible, reserva esa IP.
4. Copia `.env.example` como `.env` y completa los valores. No agregues `.env` a Git.
5. Comprueba primero el flujo con VLC:

```text
rtsp://USUARIO:CONTRASEÑA@IP_DE_LA_CAMARA:554/stream2
```

`stream1` entrega mayor calidad y es necesario para evaluar placas pequeñas. `stream2` consume menos ancho de banda y sirve cuando solo se requiere detectar vehículos.

No expongas el puerto 554 directamente a internet. Para acceso remoto se deberá utilizar una VPN.

## Ejecutar con Docker

Desde la raíz del repositorio:

```bash
cp apps/vision/.env.example apps/vision/.env
docker compose --profile vision up --build vision
```

Las detecciones se actualizan en `apps/vision/outputs/detections.json`.

## Ejecutar sin Docker

La prueba inicial se validó con Python 3.14 y PyTorch en modo CPU. Para evitar descargar varios gigabytes de librerías CUDA, instala primero la distribución CPU de PyTorch.

```bash
cd apps/vision
python -m venv .venv
source .venv/bin/activate
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
cp .env.example .env
python -m vigia_vision --source sample.mp4 --max-frames 300
```

Para utilizar la configuración RTSP del archivo `.env` en modo terminal, omite `--source`:

```bash
python -m vigia_vision
```

Para iniciar el servicio utilizado por la web:

```bash
uvicorn vigia_vision.api:app --host 127.0.0.1 --port 8001
```

Endpoints locales:

- `GET /health`: salud del proceso.
- `GET /api/v1/status`: estado de la cámara y del modelo.
- `GET /api/v1/detections`: snapshot de detecciones.
- `GET /api/v1/preview.jpg`: último frame con las cajas dibujadas.
- `GET /api/v1/stream.mjpg`: transmisión MJPEG continua para la consola.

## Modelos

El detector vehicular predeterminado es `yolo26n.pt`. Si ya existe un `.env`, actualiza `YOLO_MODEL` manualmente; el peso se descarga la primera vez.

La detección de placas es una segunda etapa opcional. Entrena o suministra un peso cuya clase se llame `plate`, `license_plate` o `placa`, y configúralo así:

```dotenv
PLATE_MODEL=/ruta/al/best.pt
PLATE_CONFIDENCE=0.45
PLATE_EVERY_N_FRAMES=5
PLATE_OUTPUT=outputs/plates
```

Cuando está habilitado, el nodo busca placas dentro de los vehículos, dibuja una caja amarilla y conserva una captura por track en `outputs/plates`. Estos archivos están excluidos de Git. El OCR todavía no se ejecuta: debe incorporarse después de validar la calidad de los recortes.

Para entrenar un peso propio:

```bash
python training/train_plate_detector.py \
  --data /ruta/al/data.yaml \
  --device cpu
```

Consulta la [estrategia de detección y lectura de placas](../../docs/modeling/license-plates.md).

## Alcance actual

- Detecta las clases COCO `car` y `motorcycle`.
- Utiliza ByteTrack para evitar contar el mismo vehículo en cada frame.
- Estima una dirección sencilla según el movimiento de la caja.
- Escribe tipo, confianza, hora, dirección y caja delimitadora.
- Puede localizar y capturar placas cuando se configura un peso especializado.
- Color, marca, modelo y texto de la placa permanecen vacíos hasta incorporar componentes especializados y OCR.

El modelo se descarga automáticamente la primera vez. Este prototipo utiliza Ultralytics YOLO; antes de un uso cerrado o comercial se deberá revisar su licencia.
