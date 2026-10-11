#!/usr/bin/env bash
# Instala en este PC el nodo de un edge creado desde la app móvil (Cámaras → Agregar edge).
# Pide el token emitido por la app sin mostrarlo y escribe apps/vision/nodes/<id>.env (0600).
# Uso: install-node-token.sh CEL-02 [FUENTE] [URL_BACKEND] [MODELO]
#   FUENTE: puerto de IP Webcam por USB (por defecto 8082) o /dev/videoN.
#   URL_BACKEND: servidor central, por defecto http://127.0.0.1:8000.
set -euo pipefail
# Uso: install-node-token.sh CEL-02 [FUENTE] [URL_SERVIDOR] [MODELO] [--auth]
#      install-node-token.sh CEL-02 --rotate      (nodo existente: solo cambia el token)
#   FUENTE: puerto del teléfono por USB (8082), /dev/videoN, o una URL rtsp(s):// o http(s)://.
#   --auth: pide usuario y contraseña de la cámara (sin mostrarlos) y los guarda solo en el nodo.
auth=0; rotate=0; positional=()
for argument in "$@"; do
  case "$argument" in
    --auth) auth=1 ;;
    --rotate) rotate=1 ;;
    *) positional+=("$argument") ;;
  esac
done
camera="${positional[0]:?Falta el identificador, p. ej. CEL-02}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root_dir/infra/edges/lib.sh"
slug="$(tr '[:upper:]' '[:lower:]' <<< "$camera")"
env_file="$root_dir/apps/vision/nodes/$slug.env"
if (( rotate )); then
  [[ -f "$env_file" ]] || { echo "No existe $env_file: instala el nodo primero (sin --rotate)." >&2; exit 1; }
  api_url="$(sed -n 's/^VIGIA_CENTRAL_API_URL=//p' "$env_file")"
else
  source_arg="${positional[1]:-8082}"
  api_url="${positional[2]:-http://127.0.0.1:8000}"
  model="${positional[3]:-Teléfono Android}"
  if (( auth )); then
    read -rp "Usuario de la cámara (para un teléfono con VIGÍA en red local: vigia): " EDGE_SOURCE_USER
    read -rsp "Contraseña o clave de la cámara: " EDGE_SOURCE_PASS; echo
    export EDGE_SOURCE_USER EDGE_SOURCE_PASS
  fi
  video_url="$(edge_video_url "$source_arg")"
  unset EDGE_SOURCE_USER EDGE_SOURCE_PASS
fi
read -rsp "Pega el token de $camera y pulsa Enter: " EDGE_TOKEN; echo
[[ "$EDGE_TOKEN" == vigia_* ]] || { echo "Eso no parece un token de VIGIA (empieza por vigia_)." >&2; exit 1; }
# Check the token against the server before saving it: wrong camera → 403, invalid → 401.
status="$(EDGE_TOKEN="$EDGE_TOKEN" python3 - "$api_url" "$camera" <<'PY'
import json, os, sys, urllib.error, urllib.request, uuid
from datetime import datetime, timezone
api, camera = sys.argv[1], sys.argv[2]
body = {"schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": str(uuid.uuid4()), "sequenceNumber": 0,
        "cameraId": camera, "generatedAt": datetime.now(timezone.utc).isoformat(), "nodeVersion": "instalacion",
        "model": "verificacion", "modelVersion": "verificacion", "frameNumber": 0, "detections": []}
request = urllib.request.Request(f"{api.rstrip('/')}/api/v1/ingest/detections", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "X-Vigia-Device-Token": os.environ["EDGE_TOKEN"]})
try:
    print(urllib.request.urlopen(request, timeout=10).status)
except urllib.error.HTTPError as error:
    print(error.code)
except OSError:
    print("sin-conexion")
PY
)"
case "$status" in
  202) ;;
  401) echo "El servidor rechazó el token (inválido, vencido o revocado)." >&2; exit 1 ;;
  403) echo "El token pertenece a otra cámara, no a $camera." >&2; exit 1 ;;
  404) echo "$camera no está registrada en $api_url." >&2; exit 1 ;;
  *) echo "No se pudo verificar el token contra $api_url ($status)." >&2; exit 1 ;;
esac
if (( rotate )); then
  # Replace only the token line, keeping the file's 0600 permissions.
  EDGE_TOKEN="$EDGE_TOKEN" python3 - "$env_file" <<'PY'
import os, sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines()
lines = [f"VIGIA_CENTRAL_API_TOKEN={os.environ['EDGE_TOKEN']}" if line.startswith("VIGIA_CENTRAL_API_TOKEN=") else line for line in lines]
with open(path, "w", encoding="utf-8") as target:
    target.write("\n".join(lines) + "\n")
PY
  unset EDGE_TOKEN
  echo "Token de $camera rotado en $env_file. Reinicia el nodo y luego revoca el token anterior en la app."
  exit 0
fi
env_file="$(EDGE_TOKEN="$EDGE_TOKEN" write_node_env "$root_dir" "$camera" "$model" "$video_url" "$api_url")"
unset EDGE_TOKEN
echo "Token verificado y guardado en $env_file"
echo "Encender: bash infra/edges/run-phone-node.sh $camera 800X SERIAL_ADB   (ver docs/operations/phone-edges.md)"
