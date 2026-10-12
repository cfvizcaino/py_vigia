#!/usr/bin/env bash
# Despliega el servidor central del piloto en una VM Ubuntu (Azure) por SSH.
# Uso: deploy.sh HOST COMANDO
#   bootstrap   instala Docker y swap (una vez)
#   push        emergencia: sube imágenes compiladas en este PC (pausa antes el autodeploy)
#   sync        copia compose, Caddyfile, grafo OSRM, autodeploy y scripts de respaldo
#   autodeploy  instala el timer que despliega lo que CI publica en GHCR desde main
#               y el vigilante que reinicia backend/web si quedan unhealthy
#   pause|resume  detiene o reanuda el autodeploy (p. ej. durante un push manual)
#   deploys     últimos despliegues automáticos
#   up          crea .env si falta (contraseña generada en el servidor), arranca y migra
#   restore F   restaura un respaldo pg_dump (-Fc) en el servidor (base vacía)
#   apk F VER   publica el APK firmado y la página https://HOST/descargar
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
    # Normal path: CI publishes to GHCR and autodeploy.sh pulls. This is the emergency
    # path; a running autodeploy would replace these images with GHCR's on its next pull.
    if remote "systemctl is-active --quiet vigia-autodeploy.timer"; then
      echo "El autodeploy está activo: ejecuta antes 'deploy.sh $host pause'." >&2; exit 1
    fi
    for name in backend web; do
      "${local_docker[@]}" tag "vigia/$name:local" "ghcr.io/cfvizcaino/vigia-$name:main"
    done
    "${local_docker[@]}" save ghcr.io/cfvizcaino/vigia-backend:main ghcr.io/cfvizcaino/vigia-web:main \
      | gzip -1 | remote 'gunzip | docker load'
    ;;
  sync)
    scp "${ssh_opts[@]}" "$root_dir/infra/azure/compose.yaml" "$root_dir/infra/azure/Caddyfile" "vigia@$host:$app/"
    scp "${ssh_opts[@]}" "$root_dir"/infra/osrm/data/region.osrm* "vigia@$host:$app/osrm/"
    scp "${ssh_opts[@]}" "$root_dir/infra/postgres/backup.sh" "$root_dir/infra/postgres/restore-check.sh" \
      "$root_dir/infra/azure/autodeploy.sh" "$root_dir/infra/azure/watchdog.sh" "vigia@$host:$app/"
    ;;
  autodeploy)
    scp "${ssh_opts[@]}" "$root_dir/infra/azure/autodeploy.sh" "$root_dir/infra/azure/watchdog.sh" \
      "$root_dir"/infra/azure/systemd/vigia-autodeploy.* "$root_dir"/infra/azure/systemd/vigia-watchdog.* "vigia@$host:$app/"
    remote "set -e; chmod 755 $app/autodeploy.sh $app/watchdog.sh
      sudo install -m 644 $app/vigia-autodeploy.service $app/vigia-autodeploy.timer \
        $app/vigia-watchdog.service $app/vigia-watchdog.timer /etc/systemd/system/
      rm $app/vigia-autodeploy.service $app/vigia-autodeploy.timer $app/vigia-watchdog.service $app/vigia-watchdog.timer
      sudo systemctl daemon-reload && sudo systemctl enable --now vigia-autodeploy.timer vigia-watchdog.timer
      systemctl list-timers 'vigia-*' --no-pager | sed -n 1,3p"
    ;;
  pause)
    remote "sudo systemctl stop vigia-autodeploy.timer && echo 'Autodeploy en pausa'"
    ;;
  resume)
    remote "sudo systemctl start vigia-autodeploy.timer && echo 'Autodeploy reanudado'"
    ;;
  deploys)
    remote "tail -n 20 $app/deploy.log 2>/dev/null || echo 'Sin despliegues todavía'; journalctl -u vigia-autodeploy --since '-1h' --no-pager -q | tail -n 5"
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
  apk)
    file="${3:?Falta el APK}"; version="${4:?Falta la versión, p. ej. 1.0.0}"
    name="vigia-$version.apk"
    sha="$(sha256sum "$file" | cut -d' ' -f1)"; size="$(du -h "$file" | cut -f1)"
    page="$(sed -e "s/{{VERSION}}/$version/g" -e "s/{{SHA256}}/$sha/g" -e "s/{{SIZE}}/$size/g" -e "s/{{FILE}}/$name/g" "$root_dir/infra/azure/descargas/index.html")"
    remote "mkdir -p $app/descargas"
    scp "${ssh_opts[@]}" "$file" "vigia@$host:$app/descargas/$name"
    scp "${ssh_opts[@]}" "$root_dir/apps/movil/assets/icon/icon.png" "vigia@$host:$app/descargas/icono.png"
    printf '%s\n' "$page" | remote "cat > $app/descargas/index.html"
    # Keep every version; vigia.apk always points to the latest.
    remote "cd $app/descargas && ln -sfn $name vigia.apk && echo '$sha  $name' > $name.sha256 && chmod a+r *"
    echo "Publicado: https://$host/descargar  ($name, SHA-256 $sha)"
    ;;
  status)
    remote "cd $app && docker compose ps --format '{{.Service}}\t{{.Status}}' && free -h | sed -n 2,3p"
    ;;
  *)
    echo "Comando desconocido: $command" >&2; exit 1 ;;
esac
