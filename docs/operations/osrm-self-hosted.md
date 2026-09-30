# OSRM propio: rutas por calles sin cobro por consulta

OSRM **sí puede usarse en producción**. Es un motor de rutas abierto sobre datos de OpenStreetMap. Lo que VIGIA no debe usar como dependencia permanente es el servidor compartido `router.project-osrm.org`: su política limita el uso razonable no comercial a una solicitud por segundo y no garantiza disponibilidad, latencia ni actualización de datos. Que VIGIA sea gratuito no elimina esos límites. [Política oficial del demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).

La alternativa adoptada es ejecutar OSRM en infraestructura propia con datos de Barranquilla y alrededores. No hay pago por cámara o solicitud. La capacidad la determinan RAM, CPU, almacenamiento, región y concurrencia; se debe medir y mantener el servicio. Las coordenadas consultadas permanecen en el despliegue.

## Cómo interviene en VIGIA

1. El correlador elige secuencias de cámaras usando observaciones y tiempo.
2. OSRM `Route` busca una ruta conducible rápida entre esas posiciones según el perfil de automóvil y el grafo vial.
3. Next.js devuelve esa geometría y MapLibre la dibuja. No es evidencia de todas las calles realmente recorridas ni incorpora tráfico en vivo automáticamente.

El procesamiento utiliza MLD (Multi-Level Dijkstra): `extract` transforma los datos OSM y aplica el perfil, `partition` prepara particiones del grafo y `customize` prepara sus pesos para servir consultas. Es el flujo recomendado por el [proyecto OSRM](https://github.com/Project-OSRM/osrm-backend/tree/v6.0.0).

`Table` servirá después para obtener distancias/tiempos viales entre cámaras para el correlador. `Match` corresponde a trazas GPS con puntos intermedios, no a inventar un recorrido a partir de dos cámaras fijas. Los `device_links` actuales siguen siendo las distancias del seed; dibujar OSRM no los recalcula todavía.

## Preparar los datos una vez

Requisitos: Docker con Compose (o Podman para el procesamiento), disco libre y memoria suficiente para el extracto escogido. No se descarga automáticamente el país completo ni el planeta.

1. Obtener un extracto OSM `.osm.pbf` de fuente confiable, por ejemplo [Geofabrik Colombia](https://download.geofabrik.de/south-america/colombia.html).
2. Preparar preferentemente un recorte de Barranquilla y su área metropolitana con margen para desvíos. Si se recorta con osmium, conservar vías completas; un límite demasiado ajustado puede crear caminos imposibles.
3. Registrar URL, fecha y checksum del extracto; respetar la atribución y condiciones de OpenStreetMap.
4. Guardarlo como `infra/osrm/data/region.osm.pbf` (datos y derivados están ignorados por Git).

Desde la raíz:

```bash
mkdir -p infra/osrm/data
# Colocar aquí el extracto antes de continuar.
sha256sum infra/osrm/data/region.osm.pbf
bash infra/osrm/prepare.sh
docker compose --profile routing up -d osrm
```

Con Podman: `CONTAINER_ENGINE=podman bash infra/osrm/prepare.sh`. Para el arranque Compose se requiere un proveedor Compose instalado. El script fija la imagen `ghcr.io/project-osrm/osrm-backend:v6.0.0`, detiene la secuencia si falla una etapa y rechaza sobrescribir un grafo MLD terminado. Procesamiento y servidor usan la misma versión.

Los montajes usan `:z` para un contexto compartido compatible con SELinux. No se generan claves ni se cambian reglas de firewall al preparar el grafo.

## Conectar la aplicación

Compose usa `ROAD_ROUTER_URL=http://osrm:5000` por defecto. Para web fuera de contenedores, en `apps/web/.env.local`:

```dotenv
ROAD_ROUTER_URL=http://127.0.0.1:5000
```

Reiniciar web tras el cambio. Para arrancar todo en Compose después de preparar datos/credenciales:

```bash
docker compose --profile routing --profile vision up -d --build
```

OSRM se publica solo en loopback. La comunicación entre servicios usa la red interna Compose. Si no se inicia el perfil `routing`, la consola indica explícitamente el fallback directo; no cambia automáticamente al demo público. Revisar `.env.local` antiguos: una URL pública definida explícitamente sigue teniendo prioridad.

## Qué probar

```bash
curl -fsS 'http://127.0.0.1:5000/nearest/v1/driving/-74.8172,11.0131?number=1'
curl -fsS 'http://127.0.0.1:5000/route/v1/driving/-74.8172,11.0131;-74.8148,11.011?overview=full&geometries=geojson'
```

Esperado: `code=Ok`, geometría `LineString` no vacía y distancia positiva. Revisar visualmente el ajuste de cada cámara a su calle; una cámara dentro de una vivienda puede encajarse en una vía equivocada. La distancia puede variar con la fecha y el perfil del mapa; los 354,4 m medidos en el demo no son un valor de aceptación universal.

En la consola, cargar el escenario del 25 de agosto y verificar **Geometría vial OSRM**. Detener únicamente OSRM, volver a consultar y comprobar el fallback identificado. El mapa base se descarga de su proveedor de teselas actual: autogestionar OSRM no vuelve offline toda la cartografía.

## Actualización y crecimiento

Procesar el siguiente extracto en un directorio de release separado, validar rutas conocidas, cambiar el montaje y recrear el servicio. Conservar el grafo anterior para rollback; no modificar archivos que `osrm-routed` esté utilizando. Medir RAM y p95 con 4/10/25 nodos/consultas antes de dimensionar; las réplicas de lectura pueden compartir la misma versión de datos. Caché por secuencia/región y actualización del grafo quedan como siguientes optimizaciones.

Esta entrega incluye receta, servicio y pruebas del adaptador; no declara un grafo local construido ni un despliegue OSRM de producción validado sin el extracto real.
