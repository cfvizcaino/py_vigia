#!/usr/bin/env bash
# Arranca el nodo de visión de un teléfono: detecta en este PC y publica con su credencial.
# Modo cámara web USB (/dev/videoN): solo arranca el nodo. Modo IP Webcam: además
# redirige por USB el puerto 8080 del teléfono (adb forward, solo loopback).
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
if [[ -n "$cam_port" && "${ADB_SKIP:-0}" != 1 ]]; then
  adb="${ADB:-$HOME/Android/Sdk/platform-tools/adb}"
  # The phone's camera port is reachable only through the USB cable, on loopback.
  "$adb" ${serial:+-s "$serial"} forward "tcp:$cam_port" tcp:8080
  echo "Cámara del teléfono en http://127.0.0.1:$cam_port/video (vía USB)"
fi
cd "$root_dir/apps/vision"
echo "Nodo $camera: estado en http://127.0.0.1:$api_port/api/v1/status"
VIGIA_ENV_FILE="$env_file" exec .venv/bin/uvicorn vigia_vision.api:app --host 127.0.0.1 --port "$api_port"
