---
version: 1
slug: "src-app-app-page-tsx"
primary_target: "src/app/app/page.tsx"
related_targets: []
---

# Superficie: descarga de la app Android (/app)

Modo: Persuade con lectura de guía (la persona decide instalar y vuelve a consultar los pasos).
Audiencia: operadores, administradores y quienes prestan un teléfono como edge o cámara. Tarea: descargar el APK correcto, instalarlo, saber qué uso darle. Prueba: versión, tamaño, fecha y SHA-256 reales del backend (`GET /api/v1/app/version`); capturas reales de la app que entregará el usuario (`public/app/capturas/`). Restricciones: sin video en la consola; Ley 1581; derechos «© 2026 Equipo VIGÍA», sin nombrar la universidad.

## Direction contract

THESIS: la descarga es un manual de una página: la acción vive arriba y el índice fijo deja volver a cualquier paso. Rechaza la landing de producto con hero gigante y tarjetas de beneficios.

OWN-WORLD: el de DESIGN.md: lienzo #090119, superficies violeta-gris, pastilla clara para la acción, círculos violeta numerados de la línea de tiempo, Poppins para títulos y DM Sans para el texto, iconos de trazo 1.7.

STORY: entiende qué es la app, la descarga verificada, la instala en tres pasos y elige su uso (operador, edge autónomo, cámara de nodo).

FIRST VIEWPORT: índice a la izquierda (≈240 px); a la derecha el título en Poppins, una línea de qué hace, la pastilla «Descargar para Android · vX» y debajo la ficha: tamaño, Android 7.0+, fecha y SHA-256 con botón Copiar.

FORM: manual con índice, posición 7 de 7 en mi lista, seed:eb4ec52f9aaa37d7.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
