#!/usr/bin/env bash
# Conecta por USB la cámara de un teléfono Android (app IP Webcam, puerto 8080 en el
# teléfono) con su nodo de visión, que detecta en este PC y publica con su credencial.
# Uso: run-phone-node.sh CEL-01 [PUERTO_API_NODO] [SERIAL_ADB]
# Sin teléfono: deja ADB_SKIP=1 y sirve un video con fake-phone-camera.py en el mismo puerto.
set -euo pipefail
camera="${1:?Falta el identificador, p. ej. CEL-01}"
api_port="${2:-8002}"
serial="${3:-}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
slug="$(tr '[:upper:]' '[:lower:]' <<< "$camera")"
env_file="$root_dir/apps/vision/nodes/$slug.env"
[[ -f "$env_file" ]] || { echo "Falta $env_file: ejecuta antes setup-phone-edge.sh" >&2; exit 1; }
cam_port="$(sed -n 's|^VIDEO_SOURCE_URL=http://127.0.0.1:\([0-9]*\)/.*|\1|p' "$env_file")"
if [[ "${ADB_SKIP:-0}" != 1 ]]; then
  adb="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
  # The phone's camera port is reachable only through the USB cable, on loopback.
  "$adb" ${serial:+-s "$serial"} forward "tcp:$cam_port" tcp:8080
  echo "Cámara del teléfono en http://127.0.0.1:$cam_port/video (vía USB)"
fi
cd "$root_dir/apps/vision"
echo "Nodo $camera: estado en http://127.0.0.1:$api_port/api/v1/status"
VIGIA_ENV_FILE="$env_file" exec .venv/bin/uvicorn vigia_vision.api:app --host 127.0.0.1 --port "$api_port"
