#!/usr/bin/env bash
# Da de alta un teléfono como cámara edge: registra el dispositivo en el backend, emite
# SU credencial y escribe la configuración del nodo en apps/vision/nodes/<id>.env (0600).
# El token nunca se imprime ni queda en el contenedor.
# Uso: setup-phone-edge.sh CEL-01 "Teléfono 1" LATITUD LONGITUD "OPPO CPH2599" [FUENTE] [SERVICIO]
#   FUENTE: /dev/videoN si el teléfono está en modo cámara web USB (Android 14+), o un
#           puerto local para IP Webcam vía adb forward. Por defecto 8081 (IP Webcam).
#   SERVICIO: backend de Compose donde registrar (backend = piloto, por defecto).
set -euo pipefail
camera="${1:?Falta el identificador, p. ej. CEL-01}"
name="${2:?Falta el nombre visible}"
lat="${3:?Falta la latitud}"
lng="${4:?Falta la longitud}"
model="${5:-Teléfono Android}"
source_arg="${6:-8081}"
service="${7:-backend}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root_dir/infra/edges/lib.sh"
video_url="$(edge_video_url "$source_arg")"
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
token="$("${compose[@]}" exec -T "$service" cat "$token_path" | sed -n 's/^VIGIA_CENTRAL_API_TOKEN=//p')"
"${compose[@]}" exec -T "$service" rm -f "$token_path"
[[ -n "$token" ]] || { echo "No se obtuvo la credencial" >&2; exit 1; }
EDGE_TOKEN="$token" write_node_env "$root_dir" "$camera" "$model" "$video_url" "http://127.0.0.1:${api_port:-8000}" >/dev/null
unset token
echo "Listo: $camera registrado, credencial emitida y configuración en $env_file"
echo "Siguiente: bash infra/edges/run-phone-node.sh $camera"
