#!/usr/bin/env bash
# Reinicia un servicio que Docker marca `unhealthy` (Compose no lo hace solo).
#
# En el benchmark del 12/10/2026 el backend quedó bloqueado y `unhealthy` sin recuperarse
# hasta un reinicio manual. Este vigilante lo hace automáticamente: cada minuto revisa
# backend y web, y reinicia el que esté `unhealthy`. Nunca actúa mientras el autodeploy
# despliega (comparte su candado) ni sobre `starting`, que es el arranque normal.
set -uo pipefail
app="${VIGIA_APP_DIR:-/opt/vigia}"
cd "$app"
exec 9>"$app/.autodeploy.lock"
flock -n 9 || exit 0  # A deploy is running; it has its own health check and rollback.
log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$app/deploy.log"; }

for service in backend web; do
  container="$(docker compose ps -q "$service" 2>/dev/null)"
  [[ -n "$container" ]] || continue
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$container" 2>/dev/null)"
  if [[ "$health" == unhealthy ]]; then
    log "Vigilante: $service unhealthy, reiniciando"
    if docker compose restart "$service" >/dev/null 2>&1; then
      log "Vigilante: $service reiniciado"
    else
      log "Vigilante: no se pudo reiniciar $service"
    fi
  fi
done
