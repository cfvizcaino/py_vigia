#!/usr/bin/env bash
# Instala en este PC el nodo de un edge creado desde la app móvil (Cámaras → Agregar edge).
# Pide el token emitido por la app sin mostrarlo y escribe apps/vision/nodes/<id>.env (0600).
# Uso: install-node-token.sh CEL-02 [FUENTE] [URL_BACKEND] [MODELO]
#   FUENTE: puerto de IP Webcam por USB (por defecto 8082) o /dev/videoN.
#   URL_BACKEND: servidor central, por defecto http://127.0.0.1:8000.
set -euo pipefail
camera="${1:?Falta el identificador, p. ej. CEL-02}"
source_arg="${2:-8082}"
api_url="${3:-http://127.0.0.1:8000}"
model="${4:-Teléfono Android}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$root_dir/infra/edges/lib.sh"
video_url="$(edge_video_url "$source_arg")"
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
env_file="$(EDGE_TOKEN="$EDGE_TOKEN" write_node_env "$root_dir" "$camera" "$model" "$video_url" "$api_url")"
unset EDGE_TOKEN
echo "Token verificado y guardado en $env_file"
echo "Encender: bash infra/edges/run-phone-node.sh $camera 800X SERIAL_ADB   (ver docs/operations/phone-edges.md)"
