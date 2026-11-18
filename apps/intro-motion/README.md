# Apertura VIGÍA · Remotion

Composición vertical basada en los estados de apertura de la página `MOBILE`
del Figma `VIGÍA-DESIGN` (nodo `2015:16`). La animación traza la red, agrega
los puntos de observación y convierte la ruta activa en el isotipo VIGÍA.

**v2 (2026-11-10):** 2,8 s en vez de 5 s, sin cuadros vacíos al inicio, pulso de
radio al llenarse el logo y salida limpia: el último cuadro es solo el fondo de la
bienvenida (W01), para pasar a ella sin salto. Los hitos están en `BEATS`
(`src/VigiaOpening.tsx`) y el guion estático está en el Figma, sección
«A0 · Apertura».

```bash
npm install
npm run dev
npm run check
npm run render          # ../../output/vigia-opening-v2.mp4 (824×1834, H.264, sin audio)
npm run render:stills   # cuadros de control vigia-opening-v2-*.png
```

Si el render se queda en «Downloading Chrome Headless Shell», hay un candado viejo en
`node_modules/.remotion/chrome-headless-shell/download.lock`. Se puede usar el Chrome de
Playwright: `npm run render -- --browser-executable=$HOME/.cache/ms-playwright/chromium_headless_shell-1208/chrome-headless-shell-linux64/chrome-headless-shell`.

Después del render: `ffmpeg -i ../../output/vigia-opening-v2.mp4 -c copy -movflags +faststart tmp.mp4`
y reemplazar, para que el reproductor arranque sin leer todo el archivo.
