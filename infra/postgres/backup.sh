#!/usr/bin/env bash
# Respaldo lógico (pg_dump -Fc) de la base VIGIA. Archivos 0600, nunca sobrescribe,
# verifica que el archivo sea legible y conserva los últimos VIGIA_BACKUP_KEEP.
# Con el Docker local del proyecto: VIGIA_COMPOSE="bash infra/docker-local.sh compose".
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${VIGIA_BACKUP_DIR:-$root_dir/backups/postgres}"
keep="${VIGIA_BACKUP_KEEP:-14}"
read -ra compose <<< "${VIGIA_COMPOSE:-docker compose}"
cd "$root_dir"
umask 077
mkdir -p "$dest"
file="$dest/vigia-$(date -u +%Y%m%dT%H%M%SZ).dump"
[[ ! -e "$file" ]] || { echo "Ya existe $file" >&2; exit 1; }
"${compose[@]}" exec -T db pg_dump -U vigia -d vigia -Fc > "$file.partial"
"${compose[@]}" exec -T db pg_restore --list < "$file.partial" > /dev/null
mv "$file.partial" "$file"
mapfile -t old < <(ls -1t "$dest"/vigia-*.dump | tail -n +"$((keep + 1))")
((${#old[@]} == 0)) || rm -- "${old[@]}"
echo "$file"
