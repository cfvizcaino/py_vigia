# OSRM propio: rutas por calles sin cobro por consulta

OSRM **sí puede usarse en producción**. Es un motor de rutas abierto sobre datos de OpenStreetMap. Lo que VIGIA no debe usar como dependencia permanente es el servidor compartido `router.project-osrm.org`: su política limita el uso razonable no comercial a una solicitud por segundo y no garantiza disponibilidad, latencia ni actualización de datos. Que VIGIA sea gratuito no elimina esos límites. [Política oficial del demo](https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server).

La alternativa adoptada es ejecutar OSRM en infraestructura propia con datos de Barranquilla y alrededores. No hay pago por cámara o solicitud. La capacidad la determinan RAM, CPU, almacenamiento, región y concurrencia; se debe medir y mantener el servicio. Las coordenadas consultadas permanecen en el despliegue.

## Cómo interviene en VIGIA

1. Una CLI sincroniza alternativas dirigidas de OSRM `Route` para las cámaras seleccionadas y guarda tiempos, distancias, costo y geometrías.
2. El correlador puntúa cada secuencia de observaciones y alternativa con pesos explícitos; una ruta más larga puede ganar si encaja mejor con el tiempo observado.
3. La consola dibuja la geometría de esa candidata y muestra su explicación. Cuando usa una geometría consultada aparte, indica **solo referencia visual**. No es evidencia de todas las calles realmente recorridas ni incorpora tráfico en vivo automáticamente.

El procesamiento utiliza MLD (Multi-Level Dijkstra): `extract` transforma los datos OSM y aplica el perfil, `partition` prepara particiones del grafo y `customize` prepara sus pesos para servir consultas. Es el flujo recomendado por el [proyecto OSRM](https://github.com/Project-OSRM/osrm-backend/tree/v6.0.0).

`Table` ofrece una matriz de referencia y está incluido en la prueba HTTP. La sincronización utiliza `Route` porque necesita las geometrías de las alternativas. `Match` corresponde a trazas GPS con puntos intermedios, no a inventar un recorrido a partir de dos cámaras fijas. [Fórmula, ejemplo y limitaciones del ranking](../architecture/weighted-routes.md).

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

Reiniciar web tras el cambio. Para arrancar todo en Compose después de [migrar la base](./database-migrations.md) y preparar datos/credenciales:

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

En la consola, cargar el escenario del 25 de agosto y verificar **Geometría vial OSRM**. Si hay alternativas sincronizadas, la geometría persiste en la base y sigue disponible al detener OSRM. El fallback visual se comprueba con enlaces no sincronizados y un enrutador indisponible. El mapa base se descarga de su proveedor de teselas actual: autogestionar OSRM no vuelve offline toda la cartografía.

## Sincronizar evidencia vial en el backend

Después de registrar las cámaras (y después del seed, si es una base de prueba), desde `apps/backend`:

```bash
python -m vigia_backend.road_network --camera CAM-01 --camera CAM-02 --camera CAM-03 --camera CAM-04
```

Con Compose:

```bash
docker compose exec backend python -m vigia_backend.road_network --url http://osrm:5000 \
  --camera CAM-01 --camera CAM-02 --camera CAM-03 --camera CAM-04
```

Se piden ambos sentidos de cada par, hasta tres opciones almacenadas por par, con ajuste máximo de 100 m. Un fallo de red/validación aborta el lote completo sin actualización parcial. `NoRoute` se guarda como ausencia explícita, no como camino en sentido inverso. Si cambia la ubicación de una cámara, sus opciones anteriores no se usan hasta resincronizar. Actualizar también tras cambiar el grafo; no hay refresco periódico automático.

## Prueba real en Docker: 30/09/2026 (Colombia)

Se ejecutó Docker Engine 29.8.1 **real, no emulación con Podman**, rootless, Compose 5.5.1, y OSRM v6.0.0. Imagen descargada con digest `sha256:729461bcc9ae9e6aafa92c0f93db9b060a32e85d5e72092c01ae4a4a9f1eb564`.

Extracto de prueba pequeño, no toda Barranquilla:

```bash
mkdir -p infra/osrm/data
# Solo si aún no existe un extracto: no sobrescribir un grafo operativo.
curl -fL 'https://api.openstreetmap.org/api/0.6/map?bbox=-74.825,10.996,-74.798,11.018' -o infra/osrm/data/region.osm
bash infra/osrm/prepare.sh
docker compose --profile routing up -d osrm
python3 infra/osrm/smoke.py
```

Fuente: OpenStreetMap contributors, atribución/ODbL. El checksum del XML utilizado fue `5e0163de08cff72f42a616ec73c83268fd9ae4c0b36154087507d60941df14fe`. Una descarga posterior puede cambiar. `prepare.sh` admite XML para esta prueba pequeña, limita el procesamiento a dos hilos y completó `extract`, `partition` y `customize`.

Resultados: cuatro `nearest` a menos de 100 m, doce pares dirigidos con geometría, matriz `Table` 4×4 válida. El servidor devolvió 20 rutas en total; la CLI guardó 19 por su límite de tres por par. CAM-01→CAM-02: **354,4 m / 39,9 s**; sentido contrario: **775,7 m / 121,9 s**. No son tiempos de tráfico real. Algunas distancias reales contradicen tiempos del seed antiguo; no se relajaron filtros para ocultarlo.

En este equipo Docker se instaló solo en `~/.local/share/vigia-docker`, sin cambiar el Docker del sistema ni reemplazar Podman. Para usarlo:

```bash
# Terminal dedicada, únicamente si ese daemon no está iniciado:
bash infra/docker-rootless.sh
# Otra terminal:
bash infra/docker-local.sh compose --profile routing up -d osrm
bash infra/docker-local.sh compose ps osrm
python3 infra/osrm/smoke.py
ss -ltn '( sport = :5000 )'
```

El último comando debe mostrar **127.0.0.1:5000**, no 0.0.0.0. La combinación inicial `pasta/implicit` abrió todas las interfaces pese al puerto loopback de Compose; se detuvo y corrigió usando `slirp4netns 1.3.5/builtin`, comprobando el socket real. Los scripts locales no descargan binarios ni registran arranque automático. Tras reiniciar el equipo hay que iniciar el daemon. Para procesar con este cliente, exportar `PATH="$HOME/.local/share/vigia-docker/bin:$PATH"` y `DOCKER_HOST=unix:///run/user/1000/vigia-docker.sock` (ajustar UID en otros equipos).

## Actualización y crecimiento

Procesar el siguiente extracto en un directorio de release separado, validar rutas conocidas, cambiar el montaje y recrear el servicio. Conservar el grafo anterior para rollback; no modificar archivos que `osrm-routed` esté utilizando. Medir RAM y p95 con 4/10/25 nodos/consultas antes de dimensionar; las réplicas de lectura pueden compartir la misma versión de datos. Caché por secuencia/región y actualización del grafo quedan como siguientes optimizaciones.

Esta entrega sí valida el arranque y respuestas reales con el extracto pequeño. No valida cobertura metropolitana completa, carga, alta disponibilidad ni un despliegue de producción.
