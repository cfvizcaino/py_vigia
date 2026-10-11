# Teléfonos como primeros edges

> **Desde la app 1.1 hay dos maneras de usar un teléfono como edge.** En el **edge autónomo** (abajo) el teléfono detecta por sí mismo y publica al servidor central: no hace falta un PC. En el **modo cámara** el teléfono solo transmite video y un nodo de visión en un PC detecta. Este segundo modo sigue siendo el camino para cámaras IP, RTSP y webcams.

## Edge autónomo (sin PC)

El teléfono hace todo lo que hacía el nodo del PC: cámara → YOLO26n en el teléfono (TensorFlow Lite, 320 px) → tracker → snapshot cada 2 s → cola en disco → `POST /api/v1/ingest/detections` con **su propio token**. El video nunca sale del teléfono: al servidor solo llegan los eventos del contrato 1.1, con las mismas claves, la misma regla de dirección y la misma idempotencia (`sessionId` + `sequenceNumber`) que el nodo Python.

```text
Cámara ─► preprocesado (isolate) ─► YOLO26n TFLite ─► tracker IoU ─► sobre 1.1 cada 2 s
                                                                       │ cola en disco (reintentos 1–30 s)
                                                                       ▼ X-Vigia-Device-Token de CEL-XX
                                                        https://vigia-…cloudapp.azure.com (Caddy ─► backend)
```

**Alta (desde el teléfono que quedará como cámara):**

1. Iniciar sesión con una cuenta admin → **Edges → Agregar edge**.
2. Elegir la ubicación y, en *Fuente de video*, **Este teléfono · detección integrada (sin PC)**.
3. En la pantalla del token, tocar **Usar en este teléfono**. El token se verifica contra el servidor, se guarda cifrado en el almacenamiento seguro y se abre **Edge autónomo**. Nunca se copia ni se muestra de nuevo.
4. **Iniciar detección**. La pantalla muestra la vista previa con los recuadros, los análisis por segundo, el tiempo de inferencia y cuántos eventos se enviaron o quedan en cola.

**Alta desde el teléfono de un administrador para otro teléfono:** registrar el edge igual que arriba y copiar el token. En el teléfono cámara, abrir VIGÍA → **Edge autónomo** (en el inicio de sesión, sin cuenta), escribir el identificador, el servidor y el token, y tocar **Verificar y guardar**. La verificación envía un sobre vacío: un 401 indica un token inválido o revocado, un 403 que el token es de otra cámara y un 404 que la cámara no está registrada.

**Rotar o revocar:** se hace desde el detalle del edge, como con los nodos de PC. Al rotar, la pantalla del token nuevo también ofrece **Usar en este teléfono**. En el teléfono cámara, el ícono de llave tachada (**Olvidar este edge**) borra el token guardado.

**Operación:**

- Mantener la app abierta y el teléfono en el cargador. La pantalla no se apaga mientras detecta.
- Si el sistema pausa la app, la detección se detiene. Los eventos pendientes quedan en disco y se envían al reanudar, también tras un reinicio.
- Sin red, los eventos se acumulan (hasta 10 000) y salen en orden cuando vuelve la conexión.
- 5 análisis por segundo bastan para tráfico urbano. Bajar a 2 reduce batería y temperatura.

**Modelo integrado.** `assets/models/vehicles.tflite` (3,1 MB, pesos INT8 y activaciones float32) y su manifiesto `vehicles.json` (entrada, formato de salida, clases y SHA-256) se generan con:

```bash
~/development/vigia-export/bin/python apps/vision/training/export_mobile.py yolo26n.pt \
    --imgsz 320 --labels 2:car,3:motorcycle --output apps/movil/assets/models/vehicles
```

El entorno `~/development/vigia-export` es aparte del nodo de visión: Python 3.12, PyTorch CPU 2.13, TensorFlow CPU 2.19 y litert-torch 0.9.4. La app lee el manifiesto, así que acepta tanto la salida *end-to-end* de YOLO26 (`[1, 300, 6]`, sin NMS) como la clásica de YOLOv8/11 (`[1, 4+clases, anclas]`, con NMS en el teléfono), en NCHW o NHWC.

Verificación (11/10/2026), con fotogramas reales de `apps/vision/captures/video-placas-01.mp4`:

- inferencia de unos 30 ms por cuadro en la CPU del PC;
- el preprocesado en Dart y el de referencia (OpenCV) detectan los mismos 5 vehículos, con recuadros a ±1 px;
- el backend valida el sobre generado por la app con `DetectionEnvelopeV11`.

**Placas (siguiente etapa).** El contrato ya trae `licensePlate` (hoy `null`) y el exportador sirve para cualquier modelo YOLO. El plan:

1. exportar el detector de placas entrenado (`apps/vision/outputs/training/…`) con `--labels 0:plate`;
2. recortar cada vehículo rastreado en el cuadro a resolución completa;
3. pasar el recorte por el detector de placas y luego por un OCR;
4. llenar `licensePlate` en el track una sola vez por vehículo.

La placa sigue siendo un dato sensible: se publica solo el texto, nunca la imagen.

## Modo cámara (con nodo en un PC)

Un teléfono Android hace de **cámara** de un nodo edge. Entrega su video por el cable USB al nodo de visión de este PC, que detecta vehículos con YOLO y publica al backend con la **credencial propia de ese teléfono**. Es el mismo flujo de la Tapo, con otra fuente de video: el contrato 1.1, la cola persistente, los reintentos y la idempotencia no cambian.

**Desde la versión 1.0 de la app, el propio VIGÍA convierte el teléfono en cámara IP** (Modo cámara), sin apps de terceros. Sirve su video como MJPEG en el puerto 8080 (`/video`, `/shot.jpg`, `/status`), igual que IP Webcam, así que el nodo no cambia. Tiene dos modos:

- **Cable USB** (recomendado): escucha solo dentro del teléfono; el PC lo alcanza con `adb forward`. Nadie en la red puede verlo.
- **Red local**: escucha en la Wi-Fi y exige una clave aleatoria (`?key=` o usuario `vigia` + clave, que es lo que usan FFmpeg y OpenCV).

La imagen sale derecha según el sensor, con una rotación extra opcional para teléfonos montados de lado. La pantalla no se apaga mientras transmite. Si el sistema pausa la app, la transmisión se detiene y se reanuda al volver; la transmisión en segundo plano queda para una versión posterior.

Otras formas de conectar la cámara:

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

## Fuentes de video admitidas

El nodo y `install-node-token.sh` validan cada tipo; las credenciales de una cámara nunca van al servidor central, solo al archivo 0600 del nodo.

| Fuente | Argumento del script | Notas |
|---|---|---|
| Teléfono con VIGÍA por cable | `8082` (puerto local) | `run-phone-node.sh` hace el `adb forward` al 8080 del teléfono |
| Teléfono con VIGÍA en red local | `'http://IP:8080/video' --auth` | Usuario `vigia` y la clave que muestra el teléfono |
| Cámara RTSP (Tapo, Hikvision…) | `'rtsp://IP:554/stream1' --auth` | Usuario y contraseña de la cámara, pedidos sin mostrarlos |
| Flujo HTTP/MJPEG | `'http://IP:PUERTO/ruta'` (`--auth` si pide clave) | |
| Webcam USB del PC | `/dev/videoN` | |

Las URL con usuario o clave escritos dentro se rechazan, para que no queden en el historial de la terminal.

## Agregar un edge desde la app móvil (recomendado)

Con una cuenta **admin** en la app VIGÍA:

1. **Cámaras → Agregar edge**. El identificador se sugiere solo (el siguiente `CEL-NN` libre).
2. Escribir el nombre y el equipo, y fijar la ubicación con **Usar mi ubicación actual** (GPS, parado donde quedará la cámara) o tocando el mapa.
3. **Registrar edge y emitir token**. La app muestra el token **una sola vez**; cópialo.
4. En el PC que procesará ese teléfono:

   ```bash
   bash infra/edges/install-node-token.sh CEL-02 8082
   ```

   Pega el token cuando lo pida (no se ve al escribir). El script lo **verifica contra el servidor** antes de guardarlo: si es de otra cámara, está vencido o revocado, lo rechaza y no escribe nada. El segundo argumento es el puerto local de IP Webcam (o `/dev/videoN`); el tercero, la URL del servidor (por defecto `http://127.0.0.1:8000`).

Tocando una cámara en la app, el admin ve sus credenciales, emite una nueva (rotación) o revoca la actual. Los operadores no ven estas opciones y el backend se las niega igualmente.

## Dar de alta desde el PC (alternativa)


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
- En el modo cámara, la detección corre en el PC. El edge autónomo detecta en el teléfono, pero solo con la app en primer plano: falta el servicio en segundo plano.
- El color del vehículo todavía no se detecta (`color: null`); las rutas usan tipo, tiempo y red vial.
