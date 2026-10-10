# Teléfonos como primeros edges

Un teléfono Android hace de **cámara** de un nodo edge. Entrega su video por el cable USB al nodo de visión de este PC, que detecta vehículos con YOLO y publica al backend con la **credencial propia de ese teléfono**. Es el mismo flujo de la Tapo, con otra fuente de video: el contrato 1.1, la cola persistente, los reintentos y la idempotencia no cambian.

Hay dos formas de conectar la cámara:

- **Cámara web USB nativa** (Android 14 o superior, recomendada). En la notificación USB del teléfono se elige **Cámara web** y el PC lo ve como una webcam más (`/dev/videoN`). No hay que instalar nada ni redirigir puertos.
- **IP Webcam** (cualquier Android): la app sirve el video en el puerto 8080 del teléfono y `adb forward` lo trae por el cable a `127.0.0.1:8081`.

```text
Teléfono (modo Cámara web USB) ──USB──► /dev/video2 ──► nodo de visión (YOLO)
Teléfono (IP Webcam :8080) ──USB / adb forward──► 127.0.0.1:8081 ──► nodo de visión (YOLO)
                                                                        │ X-Vigia-Device-Token de CEL-01
                                                                        ▼
                                                              backend 127.0.0.1:8000 ──► PostgreSQL
```

Nada queda expuesto a la red Wi-Fi: la cámara llega por el cable y el backend sigue escuchando solo en loopback. Cada teléfono tiene su propio identificador (`CEL-01`, `CEL-02`…) y su propio token: un teléfono no puede publicar como otro (el backend responde 403) y su token se revoca sin afectar a los demás.

## En el teléfono (una vez)

1. Activar la depuración USB: **Ajustes → Acerca del dispositivo → Versión**, tocar 7 veces **Número de compilación**; luego **Ajustes → Ajustes adicionales → Opciones de desarrollador → Depuración USB**. En ColorOS (OPPO) activar también **Instalar vía USB**.
2. Conectar el cable y aceptar **Permitir la depuración USB** con "Permitir siempre desde este equipo".
3. Cámara web USB: en la notificación **USB** del teléfono elegir **Cámara web**. Comprobar en el PC con `ls /dev/video*`; el teléfono aparece como un dispositivo nuevo. La webcam del portátil suele ser `/dev/video0` y `/dev/video1`, así que el teléfono quedará como `/dev/video2`.
   IP Webcam, si el teléfono no ofrece Cámara web: instalarla desde Play Store, elegir resolución de video de 1280×720 y pulsar **Iniciar servidor**. Si se le pone usuario y contraseña, añadirlos a la URL de `VIDEO_SOURCE_URL`.

Comprobar desde el PC:

```bash
~/Android/Sdk/platform-tools/adb devices        # debe listar el teléfono como "device"
```

## Dar de alta el teléfono (una vez por teléfono)

Con el backend del piloto en marcha:

```bash
export VIGIA_COMPOSE="bash infra/docker-local.sh compose"   # Docker local del proyecto
bash infra/edges/setup-phone-edge.sh CEL-01 "Teléfono Cristian" 11.0131 -74.8172 "OPPO CPH2599" /dev/video2
```

El sexto argumento es la fuente: `/dev/videoN` para el modo Cámara web, o un puerto local (por defecto 8081) para IP Webcam. Si el teléfono aparece con otro número, cambiar `VIDEO_SOURCE_URL` en el archivo del nodo.

El script hace tres cosas:
- registra `CEL-01` en la base (estado *offline* hasta su primer evento);
- emite su credencial;
- escribe `apps/vision/nodes/cel-01.env` con permisos 0600.

El token no se imprime, se borra del contenedor y la carpeta `apps/vision/nodes/` está ignorada por Git.

Usar la latitud y longitud reales de donde quedará el teléfono: las rutas dependen de ellas. Para corregirlas después:

```bash
bash infra/docker-local.sh compose exec backend python -m vigia_backend.devices relocate --camera CEL-01 --lat 11.0 --lng -74.8
```

Después de registrar o mover cámaras, sincronizar las rutas viales con OSRM ([guía](./osrm-self-hosted.md)).

## Encender el edge

```bash
bash infra/edges/run-phone-node.sh CEL-01
```

Arranca el nodo en `127.0.0.1:8002`; con IP Webcam, antes redirige el puerto 8080 del teléfono a `127.0.0.1:8081` por el cable. Su estado se ve en <http://127.0.0.1:8002/api/v1/status>: fps procesados, vehículos activos y, en `publisher`, eventos pendientes, entregados y rechazados. Detener con Ctrl+C; los eventos que no se alcanzaron a enviar quedan en la cola y salen al volver a encender.

Para un segundo teléfono: registrarlo como `CEL-02` con puerto de cámara 8082 (sexto argumento de `setup-phone-edge.sh`) y encenderlo con `run-phone-node.sh CEL-02 8003 SERIAL`, donde `SERIAL` sale de `adb devices`. Cada nodo de YOLO usa alrededor de 1 GB de RAM; en este equipo conviene uno a la vez.

## Probar sin teléfono

`fake-phone-camera.py` sirve un video en bucle como lo haría IP Webcam:

```bash
apps/vision/.venv/bin/python infra/edges/fake-phone-camera.py apps/vision/captures/video-placas-01.mp4 --port 8081
ADB_SKIP=1 bash infra/edges/run-phone-node.sh CEL-01
```

## Credenciales

- Rotar: emitir una nueva desde **Administración → Credenciales** en la consola, reemplazar `VIGIA_CENTRAL_API_TOKEN` en el archivo del nodo, reiniciar el nodo y revocar la anterior. Las dos funcionan mientras dura el cambio.
- Teléfono perdido o retirado: revocar su credencial en **Administración**. El nodo recibirá 401 y conservará sus eventos sin descartarlos.
- Toda emisión, revocación y rechazo queda en la auditoría.

## Primera validación (10/10/2026)

Teléfono OPPO CPH2599 (Android 16) como `CEL-01` en la base del piloto. Este modelo **no ofrece Cámara web USB**: el fabricante no la habilita (`ro.usb.uvc.enabled` vacío), así que se usó IP Webcam por `adb forward`. Resultados:
- video 1920×1080 a 29 fps hacia el PC;
- YOLO a 10,4 fps;
- eventos entregados al piloto con estado `online` y 0 rechazos.

Pruebas negativas en vivo:
- token propio: 202;
- token de `CEL-01` publicando como otra cámara: 403;
- sin token: 401;
- token inventado: 401.

## Límites

- El teléfono debe seguir conectado por USB y con IP Webcam activa; para una instalación fija sin cable hace falta la VPN de sedes remotas (pendiente de la decisión de conectividad).
- La detección corre en el PC, no en el teléfono.
- El color del vehículo todavía no se detecta (`color: null`); las rutas usan tipo, tiempo y red vial.
