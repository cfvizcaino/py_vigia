# Consola web de VIGIA

Primer prototipo visual del centro de monitoreo. Integra una cámara física y conserva datos simulados para validar el flujo de consulta antes de conectar el backend central.

## Funcionalidades actuales

- Mapa interactivo con una cámara física y tres nodos simulados en Barranquilla.
- Identificación visual de `CAM-01` como Tapo C110 física.
- Preview procesado de la cámara mediante el proxy interno `/api/vision`.
- Estado en línea o desconectado de cada dispositivo.
- Formulario de consulta por tipo, color, fecha, hora y radio.
- Trayectoria simulada con detecciones y porcentaje de confianza.
- Diseño adaptable a escritorio y dispositivos móviles.

## Ejecutar localmente

Requiere Node.js 20.9 o superior.

```bash
cd apps/web
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

Para visualizar la Tapo, el servicio de visión debe estar disponible en `http://127.0.0.1:8001`. Puede utilizarse otra dirección sin exponerla al navegador:

```bash
VISION_API_URL=http://127.0.0.1:8001 npm run dev
```

## Verificación

```bash
npm run lint
npm run build
```

## Próximo paso

Reemplazar el resto de los datos simulados por un API central que entregue dispositivos, detecciones y trayectorias. La cámara física ya se integra mediante un proxy server-side; las credenciales RTSP permanecen en `apps/vision`.
