#!/usr/bin/env bash
# Despliegue continuo por extracción: lo ejecuta un timer de systemd en el servidor.
# Si CI publicó imágenes nuevas de backend o web en GHCR (etiqueta main), las baja,
# migra la base, reinicia, espera la salud y, si falla, vuelve a las anteriores.
# GitHub no tiene acceso al servidor: el servidor solo descarga imágenes.
# Uso: autodeploy.sh [--force]   (--force redespliega aunque no haya cambios)
set -euo pipefail
app="${VIGIA_APP_DIR:-/opt/vigia}"
services=(backend web)
cd "$app"
exec 9>"$app/.autodeploy.lock"
flock -n 9 || exit 0  # Another run is still deploying.

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$app/deploy.log"; }
# `config --images SERVICE` also lists its dependencies on some Compose versions, so
# read the service's own image from the resolved config.
image_of() {
  docker compose config --format json \
    | python3 -c 'import json, sys; print(json.load(sys.stdin)["services"][sys.argv[1]]["image"])' "$1"
}
running_id() { docker inspect -f '{{.Image}}' "$(docker compose ps -q "$1")" 2>/dev/null || true; }
local_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
revision() { { docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null || true; } | cut -c1-7; }

# Healthy within 120 s, judged by each image's own HEALTHCHECK.
wait_healthy() {
  local service state
  for _ in $(seq 1 60); do
    local pending=0
    for service in "${services[@]}"; do
      state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$(docker compose ps -q "$service")" 2>/dev/null || echo missing)"
      case "$state" in
        healthy) ;;
        unhealthy|exited|dead|missing) return 1 ;;
        *) pending=1 ;;
      esac
    done
    (( pending )) || return 0
    sleep 2
  done
  return 1
}

declare -A previous
for service in "${services[@]}"; do previous[$service]="$(running_id "$service")"; done

# A registry outage only reaches the journal (every 2 min), not deploy.log.
if ! pull_output="$(docker compose pull -q "${services[@]}" 2>&1)"; then
  printf 'No se pudieron bajar las imágenes de GHCR; sigue la versión actual\n%s\n' "$pull_output" >&2
  exit 1
fi

changed=()
for service in "${services[@]}"; do
  if [[ "$(local_id "$(image_of "$service")")" != "${previous[$service]}" ]]; then changed+=("$service"); fi
done
if (( ${#changed[@]} == 0 )) && [[ "${1:-}" != "--force" ]]; then
  exit 0
fi

# A version that already failed stays out until CI publishes another one; otherwise
# every timer run would restart the services into it again.
candidate=""
for service in "${services[@]}"; do candidate+="$(local_id "$(image_of "$service")") "; done
failed_file="$app/.autodeploy.failed"
if [[ "${1:-}" != "--force" && -f "$failed_file" && "$(cat "$failed_file")" == "$candidate" ]]; then
  for service in "${services[@]}"; do
    if [[ -n "${previous[$service]}" ]]; then docker tag "${previous[$service]}" "$(image_of "$service")"; fi
  done
  exit 0
fi

target="$(revision "$(image_of backend)")"
log "Desplegando ${changed[*]:-todo} (commit ${target:-?})"
# Keep the running images tagged so a failed deploy can return to them.
for service in "${services[@]}"; do
  if [[ -n "${previous[$service]}" ]]; then docker tag "${previous[$service]}" "vigia/$service:previous"; fi
done

rollback() {
  log "ERROR $1: vuelvo a la versión anterior"
  printf '%s' "$candidate" > "$failed_file"
  for service in "${services[@]}"; do
    if docker image inspect "vigia/$service:previous" >/dev/null 2>&1; then
      docker tag "vigia/$service:previous" "$(image_of "$service")"
    fi
  done
  docker compose up -d --no-deps "${services[@]}" >/dev/null 2>&1 || true
  # Migrations are expand-only (see docs/operations/ci-cd.md), so the previous code
  # keeps working on the migrated schema.
  wait_healthy && log "Versión anterior restaurada" || log "ERROR la versión anterior tampoco quedó sana; revisar a mano"
  exit 1
}

docker compose run --rm --no-deps backend python -m vigia_backend.migrate upgrade >>"$app/deploy.log" 2>&1 \
  || rollback "falló la migración"
docker compose up -d --no-deps "${services[@]}" >/dev/null 2>&1 || rollback "no arrancaron los servicios"
wait_healthy || rollback "los servicios no quedaron sanos"
rm -f "$failed_file"
docker image prune -f >/dev/null  # Drop the untagged old layers; :previous stays.
log "OK commit ${target:-?} en producción"
