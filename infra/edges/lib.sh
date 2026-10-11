# Funciones compartidas por los scripts de edges. Se carga con `source`.

# Convierte la fuente en VIDEO_SOURCE_URL: /dev/videoN (cámara web USB) o un puerto
# local de IP Webcam por adb forward.
edge_video_url() {
  local source="$1"
  if [[ "$source" =~ ^/dev/video[0-9]+$ ]]; then echo "$source"
  elif [[ "$source" =~ ^[0-9]+$ ]]; then echo "http://127.0.0.1:$source/video"
  else echo "FUENTE debe ser /dev/videoN o un puerto" >&2; return 1; fi
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
