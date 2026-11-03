"""Builds src/components/icon-paths.ts from the Figma SVGs and Material Symbols Outlined.

Usage (from apps/web): python3 scripts/gen-icons.py . <material-symbols-svg-400>/package
The second path is the unpacked npm package @material-symbols/svg-400 (`npm pack` it in a
temporary folder); only the outlined SVGs listed in MATERIAL are read.
"""
import json, re, sys
from pathlib import Path
web, ms = Path(sys.argv[1]), Path(sys.argv[2])
fig = web / "design" / "figma-icons"
FIGMA = {  # icon key -> Figma export (Material Symbols drawn in Figma)
    "grid": "icon-resumen.svg", "camera": "icon-camaras.svg", "queries": "icon-consultas.svg",
    "settings": "icon-engranaje.svg", "signal": "icon-red.svg", "back": "icon-atras.svg",
    "activity": "icon-servicio.svg", "user": "icon-usuario.svg", "search": "icon-buscar.svg",
    "cameraItem": "icon-camara-lista.svg", "target": "icon-seleccionada.svg", "route": "icon-ruta.svg",
    "why": "icon-por-que.svg", "history": "icon-historial.svg", "filters": "icon-filtros.svg",
    "car": "icon-auto.svg", "motorcycle": "icon-moto.svg", "chevron": "icon-chevron.svg",
}
MATERIAL = {  # icon key -> Material Symbols Outlined file (same family as the Figma icons)
    "download": "download", "close": "close", "copy": "content_copy", "check": "check", "lock": "lock",
    "shield": "verified_user", "clock": "schedule", "logout": "logout", "phone": "mobile",
    "fingerprint": "fingerprint", "cable": "cable", "pin": "location_on", "alert": "warning",
    "recenter": "my_location", "key": "key", "arrow": "arrow_forward", "layers": "layers",
    "refresh": "refresh", "info": "info",
}
out = {}
for key, file in FIGMA.items():
    text = (fig / file).read_text()
    box = re.search(r'viewBox="([^"]+)"', text).group(1)
    paths = re.findall(r'<path[^>]* d="([^"]+)"', text)
    out[key] = {"box": box, "d": paths}
for key, name in MATERIAL.items():
    text = (ms / "outlined" / f"{name}.svg").read_text()
    out[key] = {"box": re.search(r'viewBox="([^"]+)"', text).group(1), "d": re.findall(r' d="([^"]+)"', text)}
lines = ["// Generated from the Figma «VIGÍA-DESIGN» exports and Material Symbols Outlined (Apache-2.0).",
         "// Regenerate with scripts/gen-icons.py; do not edit by hand.",
         "export const ICON_PATHS = {"]
for key, value in out.items():
    lines.append(f"  {json.dumps(key)}: {{ box: {json.dumps(value['box'])}, d: {json.dumps(value['d'])} }},")
lines.append("} as const;")
(web / "src" / "components" / "icon-paths.ts").write_text("\n".join(lines) + "\n")
print(len(out), "icons")
