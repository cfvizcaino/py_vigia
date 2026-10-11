#!/usr/bin/env bash
# Despliega el servidor central del piloto en una VM Ubuntu (Azure) por SSH.
# Uso: deploy.sh HOST COMANDO
#   bootstrap   instala Docker y swap (una vez)
#   push        sube las imágenes compiladas en este PC (backend, web)
#   sync        copia compose, Caddyfile, grafo OSRM y scripts de respaldo
#   up          crea .env si falta (contraseña generada en el servidor), arranca y migra
#   restore F   restaura un respaldo pg_dump (-Fc) en el servidor (base vacía)
#   status      estado de los servicios
# Variables: VIGIA_SSH_KEY (por defecto ~/.ssh/vigia_azure), VIGIA_COMPOSE (Docker local).
set -euo pipefail
host="${1:?Falta el host, p. ej. vigia-xxxx.mexicocentral.cloudapp.azure.com}"
command="${2:?Falta el comando}"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
key="${VIGIA_SSH_KEY:-$HOME/.ssh/vigia_azure}"
read -ra local_compose <<< "${VIGIA_COMPOSE:-docker compose}"
local_docker=("${local_compose[@]::${#local_compose[@]}-1}")  # same CLI without "compose"
ssh_opts=(-i "$key" -o StrictHostKeyChecking=accept-new -o ServerAliveInterval=30)
remote() { ssh "${ssh_opts[@]}" "vigia@$host" "$@"; }
app=/opt/vigia

case "$command" in
  bootstrap)
    remote 'set -e
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io docker-compose-v2 >/dev/null
      sudo usermod -aG docker vigia
      if ! swapon --show | grep -q /swapfile; then
        sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
        echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab >/dev/null
      fi
      sudo mkdir -p '"$app"'/osrm '"$app"'/backups && sudo chown -R vigia:vigia '"$app"'
      docker --version; docker compose version; free -h | sed -n 2,3p'
    ;;
  push)
    # Images are built here (the server has 1 GB of RAM) and streamed compressed over SSH.
    "${local_docker[@]}" save vigia/backend:local vigia/web:local | gzip -1 | remote 'gunzip | docker load'
    ;;
  sync)
    scp "${ssh_opts[@]}" "$root_dir/infra/azure/compose.yaml" "$root_dir/infra/azure/Caddyfile" "vigia@$host:$app/"
    scp "${ssh_opts[@]}" "$root_dir"/infra/osrm/data/region.osrm* "vigia@$host:$app/osrm/"
    scp "${ssh_opts[@]}" "$root_dir/infra/postgres/backup.sh" "$root_dir/infra/postgres/restore-check.sh" "vigia@$host:$app/"
    ;;
  up)
    remote "set -e; cd $app
      if [ ! -f .env ]; then
        umask 077
        printf 'VIGIA_DOMAIN=%s\nVIGIA_DB_PASSWORD=%s\n' '$host' \"\$(openssl rand -hex 24)\" > .env
        echo '.env creado en el servidor (la contraseña no sale de aquí)'
      fi
      docker compose up -d db
      docker compose run --rm backend python -m vigia_backend.migrate upgrade
      docker compose up -d
      docker compose ps --format '{{.Service}}\t{{.Status}}'"
    ;;
  restore)
    dump="${3:?Falta el archivo .dump}"
    remote "cd $app && docker compose up -d db >/dev/null && docker compose exec -T db pg_restore -U vigia -d vigia --clean --if-exists --no-owner" < "$dump"
    remote "cd $app && docker compose run --rm backend python -m vigia_backend.migrate check && docker compose restart backend >/dev/null && echo 'Base restaurada'"
    ;;
  status)
    remote "cd $app && docker compose ps --format '{{.Service}}\t{{.Status}}' && free -h | sed -n 2,3p"
    ;;
  *)
    echo "Comando desconocido: $command" >&2; exit 1 ;;
esac
