#!/usr/bin/env bash
# Da de alta un teléfono como cámara edge: registra el dispositivo en el backend, emite
# SU credencial y escribe la configuración del nodo en apps/vision/nodes/<id>.env (0600).
# El token nunca se imprime ni queda en el contenedor.
# Uso: setup-phone-edge.sh CEL-01 "Teléfono 1" LATITUD LONGITUD "OPPO CPH2599" [PUERTO_CAMARA] [SERVICIO]
#   PUERTO_CAMARA: puerto local por el que llegará la cámara (adb forward), por defecto 8081.
#   SERVICIO: backend de Compose donde registrar (backend = piloto, por defecto).
set -euo pipefail
camera="${1:?Falta el identificador, p. ej. CEL-01}"
name="${2:?Falta el nombre visible}"
lat="${3:?Falta la latitud}"
lng="${4:?Falta la longitud}"
model="${5:-Teléfono Android}"
cam_port="${6:-8081}"
service="${7:-backend}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
read -ra compose <<< "${VIGIA_COMPOSE:-docker compose}"
slug="$(tr '[:upper:]' '[:lower:]' <<< "$camera")"
env_file="$root_dir/apps/vision/nodes/$slug.env"
[[ ! -e "$env_file" ]] || { echo "Ya existe $env_file; bórralo solo si quieres rotar la credencial." >&2; exit 1; }
api_port="$(grep -oE '127\.0\.0\.1:[0-9]+:8000' "$root_dir/compose.yaml" | head -1 | cut -d: -f2)"
[[ "$service" == backend-scoring ]] && api_port=8200
cd "$root_dir"

"${compose[@]}" exec -T "$service" python -m vigia_backend.devices register \
  --camera "$camera" --name "$name" --lat "$lat" --lng "$lng" --model "$model"

token_path="/app/data/.env.$slug-token"
"${compose[@]}" exec -T "$service" python -m vigia_backend.device_credentials issue --camera "$camera" --output "$token_path" >/dev/null
umask 077
mkdir -p "$(dirname "$env_file")"
token="$("${compose[@]}" exec -T "$service" cat "$token_path" | sed -n 's/^VIGIA_CENTRAL_API_TOKEN=//p')"
"${compose[@]}" exec -T "$service" rm -f "$token_path"
[[ -n "$token" ]] || { echo "No se obtuvo la credencial" >&2; exit 1; }

cat > "$env_file" <<CONF
# Nodo edge $camera ($model). Contiene una credencial: no compartir ni subir a Git.
VIGIA_CAMERA_ID=$camera
CAMERA_MODEL=$model
VIDEO_SOURCE_URL=http://127.0.0.1:$cam_port/video
VIGIA_CENTRAL_API_URL=http://127.0.0.1:${api_port:-8000}
VIGIA_CENTRAL_API_TOKEN=$token
YOLO_MODEL=yolo26n.pt
YOLO_CONFIDENCE=0.35
EVENT_OUTBOX=outputs/nodes/$slug/outbox
DETECTION_OUTPUT=outputs/nodes/$slug/detections.json
PLATE_OUTPUT=outputs/nodes/$slug/plates
CONF
unset token
echo "Listo: $camera registrado, credencial emitida y configuración en $env_file"
echo "Siguiente: bash infra/edges/run-phone-node.sh $camera"
