#!/usr/bin/env bash
# Cliente del Docker rootless de validación; no instala ni inicia el daemon.
set -euo pipefail
vigia_docker_dir="${VIGIA_DOCKER_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/vigia-docker}"
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
if [[ ! -x "$vigia_docker_dir/bin/docker" ]]; then
  echo "Docker local de VIGIA no está instalado. Usa tu Docker habitual o consulta docs/operations/osrm-self-hosted.md." >&2
  exit 1
fi
export DOCKER_CONFIG="$vigia_docker_dir/config"
exec "$vigia_docker_dir/bin/docker" --host "unix://$runtime_dir/vigia-docker.sock" "$@"
