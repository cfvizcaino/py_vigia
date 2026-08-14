# Consola web de VIGIA

Primer prototipo visual del centro de monitoreo. Actualmente utiliza datos simulados para validar el flujo de consulta antes de conectar el backend y los dispositivos de captura.

## Funcionalidades actuales

- Mapa interactivo con cuatro cámaras simuladas en Barranquilla.
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

## Verificación

```bash
npm run lint
npm run build
```

## Próximo paso

Reemplazar los datos simulados por un API central que entregue dispositivos, detecciones y trayectorias. La integración con la cámara y el modelo de visión se realizará detrás de ese contrato.
