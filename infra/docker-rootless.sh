#!/usr/bin/env bash
# Ejecutar en una terminal dedicada. No registra servicios de arranque del host.
set -euo pipefail
vigia_docker_dir="${VIGIA_DOCKER_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/vigia-docker}"
runtime_dir="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
for binary in docker dockerd-rootless.sh slirp4netns; do
  [[ -x "$vigia_docker_dir/bin/$binary" ]] || { echo "Falta $binary en $vigia_docker_dir/bin" >&2; exit 1; }
done
export PATH="$vigia_docker_dir/bin:$PATH"
export DOCKERD_ROOTLESS_ROOTLESSKIT_NET=slirp4netns
export DOCKERD_ROOTLESS_ROOTLESSKIT_PORT_DRIVER=builtin
exec "$vigia_docker_dir/bin/dockerd-rootless.sh" --data-root="$vigia_docker_dir/data" \
  --host="unix://$runtime_dir/vigia-docker.sock" --pidfile="$runtime_dir/vigia-docker.pid"
