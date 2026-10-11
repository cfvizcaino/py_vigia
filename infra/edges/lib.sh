# Funciones compartidas por los scripts de edges. Se carga con `source`.

# Convierte la fuente en VIDEO_SOURCE_URL. Acepta:
#   /dev/videoN                     webcam USB (o teléfono en modo cámara web)
#   PUERTO                          teléfono por cable: http://127.0.0.1:PUERTO/video (adb forward)
#   rtsp(s)://host[:p]/ruta         cámara RTSP
#   http(s)://host[:p]/ruta         flujo MJPEG (p. ej. teléfono con VIGÍA en red local)
# Las URL no pueden traer usuario ni clave: llegan por EDGE_SOURCE_USER/EDGE_SOURCE_PASS
# (pedidos por el script sin mostrarlos) y se insertan codificados.
edge_video_url() {
  local source="$1"
  if [[ "$source" =~ ^/dev/video[0-9]+$ ]]; then echo "$source"; return; fi
  if [[ "$source" =~ ^[0-9]+$ ]]; then
    (( source >= 1024 && source <= 65535 )) || { echo "Puerto fuera de rango (1024-65535)" >&2; return 1; }
    echo "http://127.0.0.1:$source/video"; return
  fi
  EDGE_SOURCE_USER="${EDGE_SOURCE_USER:-}" EDGE_SOURCE_PASS="${EDGE_SOURCE_PASS:-}" python3 - "$source" <<'PY'
import os, sys
from urllib.parse import quote, urlsplit, urlunsplit
url = urlsplit(sys.argv[1])
if url.scheme not in {"rtsp", "rtsps", "http", "https"} or not url.hostname:
    sys.exit("FUENTE debe ser /dev/videoN, un puerto o una URL rtsp://, rtsps://, http:// o https:// con host")
if url.username or url.password:
    sys.exit("Quita usuario y clave de la URL; usa --auth para que se pidan sin mostrarlos")
try:
    url.port
except ValueError:
    sys.exit("Puerto no válido en la URL")
user, password = os.environ["EDGE_SOURCE_USER"], os.environ["EDGE_SOURCE_PASS"]
netloc = url.netloc
if user or password:
    netloc = f"{quote(user, safe='')}:{quote(password, safe='')}@{url.netloc}"
print(urlunsplit((url.scheme, netloc, url.path or "/", url.query, url.fragment)))
PY
}

# Escribe apps/vision/nodes/<id>.env con permisos 0600. El token llega por la variable
# de entorno EDGE_TOKEN para que nunca aparezca en la lista de procesos.
write_node_env() {
  local root_dir="$1" camera="$2" model="$3" video_url="$4" api_url="$5"
  local slug env_file
  slug="$(tr '[:upper:]' '[:lower:]' <<< "$camera")"
  env_file="$root_dir/apps/vision/nodes/$slug.env"
  [[ -n "${EDGE_TOKEN:-}" ]] || { echo "Falta la credencial" >&2; return 1; }
  [[ ! -e "$env_file" ]] || { echo "Ya existe $env_file; bórralo solo si quieres reemplazar la credencial." >&2; return 1; }
  (
    umask 077
    mkdir -p "$(dirname "$env_file")"
    cat > "$env_file" <<CONF
# Nodo edge $camera ($model). Contiene una credencial: no compartir ni subir a Git.
VIGIA_CAMERA_ID=$camera
CAMERA_MODEL=$model
VIDEO_SOURCE_URL=$video_url
VIGIA_CENTRAL_API_URL=$api_url
VIGIA_CENTRAL_API_TOKEN=$EDGE_TOKEN
YOLO_MODEL=yolo26n.pt
YOLO_CONFIDENCE=0.35
EVENT_OUTBOX=outputs/nodes/$slug/outbox
DETECTION_OUTPUT=outputs/nodes/$slug/detections.json
PLATE_OUTPUT=outputs/nodes/$slug/plates
CONF
  )
  echo "$env_file"
}
