#!/usr/bin/env bash
# Genera SegundoInforme.docx y .pdf a partir de SegundoInforme.md.
# Requiere: Node + Playwright (los de apps/web), Python con `markdown` y LibreOffice.
#   python3 -m venv /tmp/informe-venv && /tmp/informe-venv/bin/pip install markdown
#   PY=/tmp/informe-venv/bin/python bash tools/informe/build.sh [salida]
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
out="${1:-$root/output/informe}"
work="$(mktemp -d)"
mkdir -p "$out"
PLAYWRIGHT_FROM="$root/apps/web/node_modules" node "$root/tools/informe/render_mermaid.mjs" "$root/SegundoInforme.md" "$work/fig"
"${PY:-python3}" "$root/tools/informe/md2html.py" "$root/SegundoInforme.md" "$work/fig" "$work/SegundoInforme.html"
soffice --headless --convert-to "docx:MS Word 2007 XML" --infilter="HTML (StarWriter)" "$work/SegundoInforme.html" --outdir "$out" >/dev/null
soffice --headless --convert-to pdf "$out/SegundoInforme.docx" --outdir "$out" >/dev/null
rm -rf "$work"
echo "Listo: $out/SegundoInforme.docx y .pdf"
