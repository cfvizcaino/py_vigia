# Nodo de visión de VIGIA

Este componente recibe un video, una webcam o el flujo RTSP de una cámara Tapo, ejecuta detección y tracking de automóviles y motocicletas y mantiene un archivo JSON con las detecciones activas.

## Configurar la Tapo C110

1. Conecta la cámara y el computador a la misma red local.
2. En la aplicación Tapo, crea una **cuenta de cámara** para RTSP/ONVIF. No es necesariamente la misma cuenta de TP-Link.
3. Consulta en el router la IP local asignada a la cámara y, de ser posible, reserva esa IP.
4. Copia `.env.example` como `.env` y completa los valores. No agregues `.env` a Git.
5. Comprueba primero el flujo con VLC:

```text
rtsp://USUARIO:CONTRASEÑA@IP_DE_LA_CAMARA:554/stream2
```

`stream1` entrega mayor calidad; `stream2` consume menos recursos y es el punto de partida recomendado.

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

Para utilizar la configuración RTSP del archivo `.env`, omite `--source`:

```bash
python -m vigia_vision
```

## Alcance actual

- Detecta las clases COCO `car` y `motorcycle`.
- Utiliza ByteTrack para evitar contar el mismo vehículo en cada frame.
- Estima una dirección sencilla según el movimiento de la caja.
- Escribe tipo, confianza, hora, dirección y caja delimitadora.
- Color, marca, modelo y placa permanecen vacíos hasta incorporar componentes especializados.

El modelo se descarga automáticamente la primera vez. Este prototipo utiliza Ultralytics YOLO; antes de un uso cerrado o comercial se deberá revisar su licencia.
