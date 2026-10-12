# Evidencia: benchmark de carga de la alternativa B en Azure (12/10/2026)

**Veredicto:**
- **Cumple** todos los umbrales con la carga esperada (4–10 nodos) y hasta 50 nodos (25 msg/s).
- La latencia se degrada a partir de 50 msg/s, con un máximo de unos 83 msg/s.
- **Hallazgo negativo:** a 200 msg/s el backend colapsó y no se recuperó solo.

Datos crudos: [`benchmark-azure-20261012.json`](./benchmark-azure-20261012.json). Herramientas: `apps/backend/tools/load_bench.py` y `apps/backend/tools/bench_setup.py`.

## Montaje

- **Servidor (alternativa B tal como opera):** VM Azure Standard_B2ats_v2, México Central, con 2 vCPU AMD, ~0,9 GB de RAM y 2 GB de swap.
  - Caddy con TLS, un proceso Uvicorn del backend (FastAPI, endpoints síncronos, pool SQLAlchemy de 5 + 10 conexiones) y PostgreSQL 17 en la misma VM.
- **Cliente:** PC del proyecto en Barranquilla, por Internet residencial. La latencia incluye la red real.
- **Nodos simulados** con el comportamiento del edge:
  - un `Detection Envelope 1.1` por intervalo, con vehículos que aparecen, se siguen 3 a 6 sobres y se van;
  - token propio por cámara, sesión y secuencia;
  - cola en memoria con envío en orden y retroceso exponencial (0,5 a 8 s) ante errores 5xx, 429 o de red;
  - reenvío deliberado del 5 % de los sobres aceptados, que debe volver `duplicate`.
- **Datos temporales:** 100 cámaras `BENCH-001…100` en una grilla de 300 m con enlaces viales entre vecinas (hasta dos celdas), más un operador temporal.
  - Respaldo previo: `vigia-20261012T192055Z.dump`.
  - Al final se borró todo con `bench_setup.py cleanup` (100 cámaras, 1 004 enlaces, 3 261 consultas, 9 641 rutas, 3 363 registros de auditoría, 1 usuario).
- **Recursos:** se muestrearon CPU y memoria por contenedor cada ~5 s (`docker stats`).

## Umbrales de aceptación (fijados antes de medir)

| Métrica | Umbral |
|---|---|
| Throughput sostenido | ≥ 10 msg/s |
| p95 de ingestión (HTTP) | < 500 ms |
| Pérdida / duplicación lógica | 0 / 0 |
| p95 de consulta con 10 operadores | < 2 s |
| Reinicio del backend bajo carga | 0 pérdidas; cola drenada en < 60 s |

## Fase 1: escalada de ingestión (60 s por escalón)

| Nodos | Intervalo | Ofrecido (msg/s) | Aceptado (msg/s) | p50 | p95 | p99 | p95 entrega | Errores | Pendientes al cierre | Duplicados reconocidos | CPU backend (media/máx, % de 1 vCPU) | Veredicto |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 4 | 2 s | 2 | 2 | 127 ms | 217 ms | 1 500 ms | 258 ms | 0 % | 0 | 8/8 | 1 / 3 | Cumple |
| 10 | 2 s | 5 | 5 | 123 ms | 205 ms | 351 ms | 226 ms | 0 % | 0 | 10/10 | 2 / 7 | Cumple |
| 25 | 2 s | 12,5 | 12,5 | 125 ms | 146 ms | 366 ms | 183 ms | 0 % | 0 | 36/36 | 11 / 39 | Cumple |
| 50 | 2 s | 25 | 25 | 127 ms | 152 ms | 388 ms | 190 ms | 0 % | 0 | 79/79 | 17 / 26 | Cumple |
| 100 | 2 s | 50 | 50 | 131 ms | 1 336 ms | 2 579 ms | 1 584 ms | 0 % | 0 | 149/149 | 37 / 108 | No cumple (latencia) |
| 100 | 1 s | 100 | 82,8 | 448 ms | 836 ms | 1 064 ms | 902 ms | 7,1 % | 1 025 | 257/261 | 71 / 142 | No cumple |
| 100 | 0,5 s | 200 | 0 | — | — | — | — | 100 % | 11 943 | — | 2 / 17 (bloqueado) | Colapso |

**Cómo leer la tabla:**

- **Pendientes al cierre:** sobres que seguían en la cola del nodo cuando terminó la ventana de drenaje (30 s). No se descartaron; un edge real los enviaría después. En los escalones sanos, la pérdida fue 0.
- **p99 de 1,5 s con 4 nodos:** corresponde a los saludos TLS iniciales en una muestra pequeña, de unas 120 peticiones.

**Integridad en la base:**

- 15 255 eventos guardados, todos únicos por `eventId` y por (cámara, sesión, secuencia).
- 5 405 detecciones lógicas para 5 405 observaciones: una por track, sin duplicados.
- El cliente contó 15 197 aceptados; los 58 restantes son sobres que el servidor guardó durante la saturación y cuya respuesta no llegó a tiempo. Quedaron igualmente una sola vez.

**Colapso a 200 msg/s:**

- Las peticiones esperan hasta 30 s por una conexión del pool de SQLAlchemy (5 + 10). El cliente corta a los 10 s y reintenta, y los reintentos mantienen el pool agotado: una tormenta de reintentos.
- El backend quedó `unhealthy` y siguió así más de 2 minutos después de detener la carga, hasta que se reinició a mano (~10 min sin API). La base no perdió datos.
- **Corrección propuesta:**
  - tiempo de espera corto del pool, con respuesta 503 inmediata en lugar de esperar 30 s;
  - límite de concurrencia acorde al pool;
  - más de un proceso de Uvicorn;
  - reinicio automático del contenedor cuando su chequeo de salud falla.
- Después de corregirlo hay que repetir la escalada.

## Fase 2: consultas (60 s por escalón, con 25 nodos publicando de fondo)

Cada consulta usa un radio de 600 m alrededor de una cámara al azar, una ventana de 3 minutos y el tipo "auto", y la mitad de las veces un color.

| Operadores | Consultas | Consultas/s | p50 | p95 | p99 | Detecciones candidatas (media) | Respuestas | Veredicto |
|---:|---:|---:|---:|---:|---:|---:|---|---|
| 1 | 379 | 6,3 | 128 ms | 204 ms | 599 ms | 5,6 | 379 × 200 | Cumple |
| 5 | 1 563 | 26,1 | 160 ms | 331 ms | 583 ms | 14,6 | 1 563 × 200 | Cumple |
| 10 | 1 319 | 22,0 | 372 ms | 1 014 ms | 1 358 ms | 20,9 | 1 319 × 200 | Cumple |

Durante estas consultas, la ingestión de fondo (25 nodos, 12,5 msg/s) entregó todo, sin errores ni pendientes, pero con **p95 de 614 ms**: por encima del umbral de 500 ms. Las consultas y la ingestión compiten por el mismo proceso del backend. La carga esperada del piloto (4 a 10 nodos y pocos operadores) queda por debajo de esta combinación, pero la separación de trabajadores es la misma corrección propuesta arriba.

## Fase 3: reinicio del backend bajo carga

25 nodos durante 180 s, con `docker compose restart backend` en el segundo 60:

| Medida | Resultado |
|---|---|
| Sobres generados / aceptados | 2 249 / 2 249 |
| Perdidos | **0** |
| Backend fuera de servicio | 12,8 s (100 respuestas 502, todas reintentadas) |
| Cola drenada tras volver | 2,2 s |
| Entrega p95 / máxima | 2,7 s / 10,3 s |
| Reenvíos deliberados reconocidos como `duplicate` | 106/106 |

**Veredicto:** cumple (0 pérdidas; drenado < 60 s).

## Alternativa A: costos medidos

- **Red:** el flujo principal de la Tapo C110 (2304×1296) mide **1,10 Mbit/s** (90 s, escena nocturna casi estática, cota inferior), unos 0,5 GB por hora.
  - El sobre medio de la misma cámara mide unos **2,7 KB cada 2 s** (339 B de cabecera más 272 B por detección, con 8,8 detecciones de media según producción), es decir, **~11 kbit/s, unas 100 veces menos**.
- **Inferencia:** YOLO26n a 640 px tarda **96 ms por cuadro** usando los 8 hilos de un AMD Ryzen 7 3700U (~10 cuadros/s); a 320 px, 36 ms.
  - Diez cámaras a 8 análisis/s exigirían unas 8 veces esa CPU completa, solo para inferir en el centro.
  - En B, la central dedicó un 2 % de una vCPU a 10 nodos.

## Repetición tras la corrección (12/10/2026, 23:00 UTC)

**Corrección aplicada** (PR #27):
- descarte de carga con 503 inmediato (20 peticiones simultáneas por proceso);
- espera máxima de 5 s por una conexión del pool;
- dos procesos de Uvicorn;
- vigilante que reinicia los servicios `unhealthy`.

Misma herramienta y mismos escalones. Esta vez el cliente estaba en otra red residencial. Datos crudos: [`benchmark-azure-20261012-repeticion.json`](./benchmark-azure-20261012-repeticion.json).

| Nodos × intervalo | Ofrecido → aceptado (msg/s) | p50 / p95 | p95 entrega | Respuestas 503 / 502 | Pendientes al cierre | Antes de la corrección |
|---|---:|---:|---:|---:|---:|---|
| 4 × 2 s | 2 → 2 | 137 / 361 ms | 400 ms | 0 / 0 | 0 | 127 / 217 ms |
| 10 × 2 s | 5 → 5 | 124 / 189 ms | 214 ms | 0 / 0 | 0 | 123 / 205 ms |
| 25 × 2 s | 12,5 → 12,5 | 125 / 171 ms | 206 ms | 0 / 0 | 0 | 125 / 146 ms |
| 50 × 2 s | 25 → 25 | 126 / 160 ms | 200 ms | 0 / 0 | 0 | 127 / 152 ms |
| 100 × 2 s | 50 → 50 | 131 / **377 ms** | 409 ms | 0 / 0 | 0 | 131 / 1 336 ms (no cumplía) |
| 100 × 1 s | 100 → **99,8** | 253 / 970 ms | 25,8 s | 1 476 / 22 | **0** | 82,8 msg/s, 1 025 pendientes |
| 100 × 0,5 s | 200 → **184,3** | 329 / 531 ms | 38,7 s | 4 311 / 0 | 870 | **0 msg/s: colapso** |

**Resultados:**

- **Ya no colapsa.** A 200 msg/s entran 184 msg/s y el resto recibe 503 al instante; los nodos los reintentan. `/health` respondió 200 en las 129 sondas de toda la corrida (p95 de 2,0 s, máximo de 6,6 s), sin reinicios manuales ni del vigilante, y al terminar respondía en 0,5 s.
- **Capacidad:** el umbral de latencia (p95 < 500 ms) ahora se cumple hasta 50 msg/s (100 nodos), el doble que antes.
- **Retraso de entrega:** bajo sobrecarga sube a decenas de segundos, porque los sobres esperan en la cola del nodo con retroceso. Es el comportamiento buscado: el centro se protege y los eventos llegan después.
- **Integridad:** 25 028 eventos aceptados por el cliente y 25 028 en la base, todos únicos; 8 784 detecciones para 8 784 tracks. Algunos reenvíos deliberados no volvieron como `duplicate` (248/292 y 395/535) porque recibieron un 503, no porque se duplicaran: la base no tiene ningún evento repetido.
- **Los 22 errores 502** se deben a que el supervisor de Uvicorn reinició un proceso que no respondió su chequeo interno en 5 s mientras la CPU estaba saturada (4 reinicios en toda la corrida). Se amplió ese plazo a 30 s (`UVICORN_TIMEOUT_WORKER_HEALTHCHECK`); un bloqueo real lo sigue cubriendo el vigilante.
- **Memoria justa:** OSRM ocupa ~530 MB de los 892 MB de la VM y quedó en swap durante la prueba; los dos procesos del backend llegaron a 230 MB.

**Consultas con datos densos.** Esta vez las consultas empezaron justo después del escalón de 200 msg/s. Con una ventana de 3 minutos, cada consulta procesó en promedio 220 detecciones candidatas (antes, 5,6):

| Operadores | Consultas/s | p50 | p95 | Candidatas (media) | 503 |
|---:|---:|---:|---:|---:|---:|
| 1 | 0,6 | 707 ms | 8 353 ms | 220 | 0 |
| 5 | 2,9 | 1 095 ms | 6 386 ms | 141 | 15 |
| 10 | 11,7 | 496 ms | 2 483 ms | 31 | 47 |

El costo de reconstruir rutas crece con fuerza con el número de detecciones candidatas: hoy se evalúan todos los pares. Con ~30 candidatas el p95 vuelve a rondar los 2 s, y con 140 a 220 supera los 6 s. **Nuevo hallazgo:** hay que acotar la búsqueda, generando solo los pares con enlace vial y dentro de la ventana temporal compatible, antes de exponer consultas sobre zonas densas.
