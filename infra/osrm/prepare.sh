#!/usr/bin/env bash
# Procesa un extracto propio, nunca descarga un país entero implícitamente.
set -euo pipefail
engine="${CONTAINER_ENGINE:-docker}"
image="ghcr.io/project-osrm/osrm-backend:v6.0.0"
root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
data_dir="$root_dir/infra/osrm/data"
command -v "$engine" >/dev/null || { echo "Falta $engine (o define CONTAINER_ENGINE=podman)." >&2; exit 1; }
if [[ ! -s "$data_dir/region.osm.pbf" ]]; then
  echo "Coloca un extracto OSM de tu región en $data_dir/region.osm.pbf" >&2
  exit 1
fi
if [[ -e "$data_dir/region.osrm.mldgr" ]]; then
  echo "Ya existe un grafo procesado. Prepara una carpeta/release nueva para actualizar sin sobrescribirlo." >&2
  exit 1
fi
for stage in extract partition customize; do
  if [[ "$stage" == extract ]]; then
    "$engine" run --rm -v "$data_dir:/data:z" "$image" osrm-extract -p /opt/car.lua /data/region.osm.pbf
  else
    "$engine" run --rm -v "$data_dir:/data:z" "$image" "osrm-$stage" /data/region.osrm
  fi
done
echo "Grafo MLD listo. Arranca: docker compose --profile routing up -d osrm"
