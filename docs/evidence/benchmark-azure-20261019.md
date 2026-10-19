# Benchmark del 19/10/2026: latencia media y máxima con la carga esperada

Corrida corta contra el servidor del piloto para medir lo que el benchmark del 12/10 no guardó: la **latencia media y la máxima** de la ingestión y de las consultas. No repite la búsqueda de la saturación ni la prueba de fallo ([benchmark del 12/10](./benchmark-azure-20261012.md)).

Datos crudos: [`benchmark-azure-20261019.json`](./benchmark-azure-20261019.json). Herramientas: `apps/backend/tools/load_bench.py` (con `http_mean_ms`, `http_max_ms`, `mean_ms`, `max_ms` y la opción `--steps`) y `apps/backend/tools/bench_setup.py`.

## Montaje

- **Servidor:** el mismo del 12/10 después de la corrección (VM Standard_B2ats_v2, backend con 2 procesos, descarte de carga a partir de 20 peticiones en curso por proceso, pool que espera como máximo 5 s).
- **Generador:** el portátil de desarrollo en Barranquilla, por Internet residencial; la latencia incluye la red real.
- **Preparación:** respaldo `vigia-20261019T071439Z.dump`; `bench_setup.py setup 100` (100 cámaras `BENCH-`, enlaces entre vecinas y un operador temporal). Tokens en un archivo 0600 borrado al terminar.
- **Fases:** ingestión con 4, 10, 25, 50 y 100 nodos, un sobre cada 2 s, 60 s por escalón; luego consultas con 1, 5 y 10 operadores durante 60 s cada uno, mientras 25 nodos publican.
- **Limpieza:** `bench_setup.py cleanup` borró 100 cámaras, 1 004 enlaces, 1 564 consultas, 10 401 rutas, 1 666 registros de auditoría y el usuario temporal. Los conteos volvieron a los previos (5 dispositivos, 1 994 detecciones, 2 personas, 15 consultas).

## Ingestión

| Nodos × intervalo | Ofrecido → aceptado (msg/s) | Media | p50 | p95 | p99 | Máxima | 503 | Perdidos |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 4 × 2 s | 2 → 2 | 173 ms | 126 ms | 512 ms | 1 007 ms | 1 538 ms | 0 | 0 |
| 10 × 2 s | 5 → 5 | 138 ms | 124 ms | 181 ms | 379 ms | 1 504 ms | 0 | 0 |
| 25 × 2 s | 12,5 → 12,5 | 132 ms | 123 ms | 139 ms | 371 ms | 463 ms | 0 | 0 |
| 50 × 2 s | 25 → 25 | 136 ms | 123 ms | 153 ms | 436 ms | 742 ms | 0 | 0 |
| 100 × 2 s | 50 → 50 | 193 ms | 128 ms | 397 ms | 2 414 ms | 3 512 ms | 75 (2,3 %) | 0 |

- **Con la carga esperada (4 a 10 nodos) y hasta 50 nodos**, la latencia media está entre 132 y 173 ms y la mediana es estable, cerca de 125 ms, que es sobre todo la ida y vuelta por Internet desde Barranquilla hasta México.
- **Las máximas son casos aislados.** Con 4 y 10 nodos llegan a 1,5 s, y en el primer escalón el p95 queda en 512 ms, en el límite del umbral de 500 ms: con solo 120 peticiones, el 5 % más lento son 6 peticiones. Se atribuyen, sin haberlo aislado, a la apertura de conexiones TLS de cada nodo al empezar el escalón.
- **A 50 msg/s** el descarte de carga actúa: 75 peticiones (2,3 %) reciben 503 y se reintentan; todas se entregan y el p95 sigue por debajo de 500 ms.
- **Integridad:** el cliente recibió acuse de 7 983 eventos y la base guardó 7 983, todos únicos; 2 771 detecciones para 2 771 tracks. Un reenvío deliberado (144/145) no volvió como `duplicate` porque recibió un 503, no porque se duplicara.

## Consultas con 25 nodos publicando

| Operadores | Consultas | Media | p50 | p95 | p99 | Máxima | Candidatas (media) | Respuestas |
|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 237 | 253 ms | 177 ms | 358 ms | 1 769 ms | 7 479 ms | 73,2 | 237 × 200 |
| 5 | 471 | 425 ms | 431 ms | 677 ms | 818 ms | 951 ms | 61,6 | 471 × 200; 5 sin respuesta en 30 s |
| 10 | 938 | 640 ms | 438 ms | 1 543 ms | 4 624 ms | 6 469 ms | 35,9 | 851 × 200; 87 × 503 |

- **El p95 cumple el umbral de 2 s** con 1, 5 y 10 operadores, pero con más detecciones candidatas que el 12/10 (36 a 73 por consulta, frente a 6 a 21): los escalones de ingestión anteriores dejaron la zona densa dentro de la ventana de 3 minutos.
- **Hallazgo negativo.** Con 10 operadores, el 9 % de las consultas recibió 503, y la ingestión de fondo empeoró: media de 554 ms, p95 de 2,5 s, 213 respuestas 503, 34 sin respuesta y una entrega máxima de 45 s. No se perdió ningún evento (2 316 de 2 316). Consultas e ingestión comparten los mismos dos procesos del backend, y las consultas densas los ocupan. Refuerza el pendiente P0 de acotar las consultas en zonas densas y sugiere separar los procesos de ingestión de los de consulta.
