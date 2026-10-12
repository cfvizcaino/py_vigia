"""Markdown del informe → HTML autocontenido para LibreOffice (→ .docx).

Uso: python md2html.py INFORME.md FIG_DIR SALIDA.html
Los bloques ```mermaid se sustituyen por las figuras renderizadas (figura-N.png),
incrustadas en base64 para que LibreOffice las embeba en el .docx.
"""
import base64
import json
import re
import sys
from pathlib import Path

import markdown

source, fig_dir, output = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
text = source.read_text(encoding="utf-8")
sizes = {s["file"]: s for s in json.loads((fig_dir / "sizes.json").read_text())}
counter = iter(range(1, 100))
captions = {
    1: "Arquitectura general implementada (líneas punteadas: evolución).",
    2: "Componentes del borde, el centro y la presentación, con el flujo de despliegue continuo.",
    3: "Secuencia de publicación con cola, acuse idempotente y consulta auditada.",
    4: "Despliegue continuo por extracción con reversión automática.",
}


def figure(_match):
    n = next(counter)
    name = f"figura-{n}.png"
    data = base64.b64encode((fig_dir / name).read_bytes()).decode()
    w, h = sizes[name]["width"], sizes[name]["height"]
    width_cm = min(16.0, w / 96 * 2.54 * 0.8, 20.0 * w / h)
    height_cm = width_cm * h / w
    return (f'\n<p class="fig"><img src="data:image/png;base64,{data}" style="width:{width_cm:.2f}cm;height:{height_cm:.2f}cm"/></p>\n'
            f'<p class="caption">Figura {n}. {captions.get(n, "")}</p>\n')


text = re.sub(r"```mermaid\n[\s\S]*?```", figure, text)
# Internal links to repository files: keep the text, show the path (a Word reader has no repo).
text = re.sub(r"\[([^\]]+)\]\(\./([^)]+)\)", r"\1 (`\2`)", text)
body = markdown.markdown(text, extensions=["tables", "fenced_code", "sane_lists"])
# LibreOffice's HTML import ignores CSS borders on tables; use the attributes.
body = body.replace("<table>", '<table border="1" cellspacing="0" cellpadding="4" width="100%">')
html = f"""<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Segundo informe - VIGIA</title>
<style>
body {{ font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.35; }}
h1 {{ font-size: 16pt; margin-top: 18pt; }} h2 {{ font-size: 13pt; margin-top: 12pt; }}
table {{ border-collapse: collapse; width: 100%; font-size: 9pt; margin: 6pt 0; }}
th, td {{ border: 1px solid #888; padding: 3pt 5pt; vertical-align: top; }}
th {{ background: #e8ecef; }}
code {{ font-family: 'Courier New', monospace; font-size: 9.5pt; }}
pre {{ background: #f4f4f4; padding: 6pt; font-size: 9pt; }}
p.fig {{ text-align: center; }} p.caption {{ text-align: center; font-size: 9.5pt; font-style: italic; }}
</style></head><body>{body}</body></html>"""
output.write_text(html, encoding="utf-8")
print("ok", output)
