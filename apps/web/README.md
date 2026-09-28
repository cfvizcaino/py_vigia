# Consola web de VIGIA

Centro de operaciones con Next.js y MapLibre para explorar la red comunitaria de
Barranquilla, consultar detecciones y comparar trayectorias estimadas.

## Funcionalidades

- Interfaz oscura con acentos naranja y turquesa, tarjetas de métricas y diseño adaptable.
- Dispositivos desde el backend central, selección en mapa y búsqueda por nombre.
- Consulta por cámara de referencia, radio, tipo, color, fecha y ventana horaria.
- Horarios de Colombia (UTC−5), convertidos explícitamente para el API.
- Varias rutas candidatas, confianza, secuencia de detecciones y aviso de tramos distantes.
- Radio visible en mapa y botón para encuadrar la red o la ruta seleccionada.
- Historial de las últimas 20 consultas de esta sesión y exportación JSON con origen de datos.
- Vista MJPEG de la Tapo C110 mediante el proxy existente de visión.
- Demostración local opcional cuando no hay conexión central; nunca reemplaza una consulta real fallida.
- Estados de carga, errores, resultados vacíos, navegación por teclado y movimiento reducido.

Las métricas corresponden a la red cargada y a la consulta seleccionada. El estado
registrado de una cámara no prueba que su transmisión esté disponible; la vista de
la Tapo consulta por separado el servicio de visión. El servidor solicita a OSRM una
geometría conducible entre cámaras; si falla, la consola identifica y dibuja un enlace
directo discontinuo. En ambos casos la ruta es una hipótesis, no una identificación confirmada.

## Ejecutar

Requiere Node.js 20.9 o superior.

```bash
cd apps/web
npm install
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000).
Configura las URLs en `.env.local` si los servicios usan otros puertos:

```dotenv
BACKEND_API_URL=http://127.0.0.1:8000
VISION_API_URL=http://127.0.0.1:8001
ROAD_ROUTER_URL=https://router.project-osrm.org
```

Los valores son del servidor; las direcciones internas y credenciales RTSP no se
publican al navegador. En contenedores, usa nombres de servicio accesibles desde
el contenedor web, no `127.0.0.1`.

Inicia el backend siguiendo [su guía](../backend/README.md). Su seed contiene datos
del **25 de agosto de 2026, desde las 09:30 de Colombia**. El botón **Cargar escenario
de prueba · 25 ago.** prepara una búsqueda de automóvil blanco entre 09:20 y 10:30.
El seed reinicia los datos de la base: úsalo únicamente en una base de desarrollo.

Sin backend, pulsa **Explorar demo** y **Buscar en la demostración**. Los filtros se
aplican a un conjunto reducido de ejemplos locales; sus rutas y porcentajes son
ilustrativos y no ejecutan el algoritmo del backend. La cámara física aparece sin
conexión en esta demostración porque no se deduce su disponibilidad.

## Endpoints de la consola

| Método | Ruta | Servicio central |
|---|---|---|
| GET | `/api/monitoring/devices` | `GET /api/v1/devices` |
| POST | `/api/monitoring/queries` | `GET /api/v1/queries` |
| POST | `/api/monitoring/route-geometry` | OSRM Route API |

La consulta se expone como POST porque el GET del backend persiste resultados.
Se validan los filtros, se deshabilita la caché y se limita la espera al servicio a
10 segundos. Las consultas fallidas muestran el error sin sustituir datos.

El worker ESM de MapLibre y su módulo compartido se copian desde la dependencia
instalada a `public/maplibre/` antes de `dev` y `build`. Esto permite dibujar las
rutas y el radio con Turbopack; esos archivos generados no se versionan.

## Verificación

```bash
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Las pruebas de navegador levantan la consola en el puerto 3100 y verifican
escritorio y móvil con respuestas de API controladas: demo, filtros, rutas,
exportación, historial, conexión central, errores y búsqueda de cámaras.
Las capturas quedan en `test-results/`, ignorado por Git.

## Pendiente

Autenticación y autorización, historial persistente por usuario, actualización
automática del estado de dispositivos y migración opcional a PostGIS/MQTT cuando
la escala lo justifique. El historial web actual vive en
memoria y desaparece al recargar la página o reconectar la red.
