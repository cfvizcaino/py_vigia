#!/usr/bin/env bash
# Prueba de restauración: carga un respaldo en una base temporal, compara conteos con la
# base viva y la elimina. No toca la base `vigia`. Uso: restore-check.sh [ARCHIVO.dump]
set -euo pipefail
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
dest="${VIGIA_BACKUP_DIR:-$root_dir/backups/postgres}"
read -ra compose <<< "${VIGIA_COMPOSE:-docker compose}"
cd "$root_dir"
file="${1:-$(ls -1t "$dest"/vigia-*.dump 2>/dev/null | head -1)}"
[[ -s "$file" ]] || { echo "No hay respaldo para verificar" >&2; exit 1; }
scratch="vigia_restore_check"
psql() { "${compose[@]}" exec -T db psql -U vigia -v ON_ERROR_STOP=1 -qAt "$@"; }
psql -d vigia -c "DROP DATABASE IF EXISTS $scratch" -c "CREATE DATABASE $scratch"
trap 'psql -d vigia -c "DROP DATABASE IF EXISTS $scratch" >/dev/null' EXIT
"${compose[@]}" exec -T db pg_restore -U vigia -d "$scratch" --no-owner < "$file"
# Live counts may have grown since the dump; the restored copy must be complete up to it.
status=0
for table in alembic_version users devices detections ingested_events queries security_audit; do
  restored=$(psql -d "$scratch" -c "SELECT count(*) FROM $table")
  live=$(psql -d vigia -c "SELECT count(*) FROM $table")
  printf '%-18s restaurado=%-8s vivo=%s\n' "$table" "$restored" "$live"
  ((restored <= live)) || status=1
done
[[ "$(psql -d "$scratch" -c 'SELECT version_num FROM alembic_version')" == "$(psql -d vigia -c 'SELECT version_num FROM alembic_version')" ]] || status=1
((status == 0)) && echo "Restauración verificada: $file" || { echo "La restauración no coincide" >&2; exit 1; }
