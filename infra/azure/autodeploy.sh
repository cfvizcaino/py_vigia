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
image_of() { docker compose config --images "$1"; }
running_id() { docker inspect -f '{{.Image}}' "$(docker compose ps -q "$1")" 2>/dev/null || true; }
local_id() { docker image inspect -f '{{.Id}}' "$1" 2>/dev/null || true; }
revision() { docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$1" 2>/dev/null | cut -c1-7; }

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
if ! docker compose pull -q "${services[@]}"; then
  echo "No se pudieron bajar las imágenes de GHCR; sigue la versión actual" >&2
  exit 1
fi

changed=()
for service in "${services[@]}"; do
  if [[ "$(local_id "$(image_of "$service")")" != "${previous[$service]}" ]]; then changed+=("$service"); fi
done
if (( ${#changed[@]} == 0 )) && [[ "${1:-}" != "--force" ]]; then
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
docker image prune -f >/dev/null  # Drop the untagged old layers; :previous stays.
log "OK commit ${target:-?} en producción"
