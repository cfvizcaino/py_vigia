# Evidencia P1.2: resiliencia edge → centro (08/10/2026)

**Veredicto: aprobado.** Datos crudos (muestras por segundo y línea de tiempo): [`p12-resiliencia-20261008.json`](./p12-resiliencia-20261008.json). Procedimiento: [prueba de resiliencia](../operations/resilience.md).

Entorno: stack Compose real (backend en contenedor, PostgreSQL 17.11) sobre Docker 29.8.1 rootless; publicador real del nodo con timeout de 10 s y backoff de 1–30 s con jitter; nodo simulado (sin cámara) con un snapshot cada 2 s. Todo en una sola máquina.

## Integridad

| Medida | Resultado |
|---|---|
| Eventos generados | 248, en 2 sesiones del nodo (reinicio a mitad del corte) |
| Eventos guardados | 248, todos únicos |
| Faltantes / sobrantes | 0 / 0 |
| Rechazados por el nodo | 0 |
| Tracks generados → observaciones guardadas | 115 → 115, sin duplicados |
| Reenvíos por acuse perdido | 4 respuestas descartadas por el proxy; el backend respondió 4 veces `duplicate` |

## Cola y recuperación

| Falla | Duración | Cola máxima | Drenaje tras volver el servicio |
|---|---|---|---|
| Corte de red con reinicio del nodo | 300 s | 157 eventos (149 al volver la red) | 19,1 s |
| Acuses perdidos | 40 s | — | 17,0 s |
| Backend detenido | 15 s | — | 13,0 s |
| PostgreSQL detenido | 15 s | 9 eventos | 4,5 s |

El drenaje lo domina la espera del reintento en curso: el nodo puede estar hasta 30 s (más el timeout de 10 s) esperando antes de notar que el centro volvió. Una vez conectado, los 149 eventos acumulados se envían en pocos segundos. El tope anterior de 60 s habría duplicado ese peor caso.

## Latencia (recepción − generación)

| Eventos generados durante | n | p50 | p95 | máx |
|---|---:|---:|---:|---:|
| Operación normal | 29 | 0,025 s | 0,035 s | 0,039 s |
| Corte de 5 min | 149 | 170,5 s | 302,5 s | 316,3 s |
| Recuperación | 27 | 7,9 s | 15,9 s | 17,8 s |
| Acuses perdidos | 20 | 35,6 s | 51,4 s | 53,4 s |
| Backend detenido | 10 | 20,0 s | 29,9 s | 29,9 s |
| PostgreSQL detenido | 8 | 12,6 s | 18,5 s | 18,5 s |
| Cierre | 5 | 0,031 s | 0,040 s | 0,040 s |

En operación normal la entrega tarda unos 25 ms en la misma máquina. Durante una falla la latencia equivale al tiempo de espera; lo importante es que el dato llega completo y sin duplicarse.

## Defectos encontrados y corregidos en este incremento

1. **Bloqueo de la cola por un evento rechazado.** El publicador reintentaba para siempre cualquier error, incluido un 409 permanente; un solo evento así detenía todos los siguientes. Ahora los rechazos propios del evento (400, 409, 413, 422) y los archivos ilegibles pasan a `outbox/rejected/`, y los errores del nodo o transitorios se reintentan sin descartar. Prueba: `apps/vision/tests/test_publisher.py`, que con el código anterior no vacía la cola.
2. **Reintentos concurrentes en PostgreSQL** (incremento anterior, verificado aquí): dos envíos del mismo evento ya no producen un error 500.

## Qué no demuestra

- No reemplaza la sesión prolongada con la cámara Tapo real, que no era accesible desde este equipo el 08/10, ni la prueba entre dos redes reales por VPN (P0.1 y P0.2).
- El corte se simula en un proxy local: no hay pérdida de paquetes, latencia de enlace ni NAT reales.
- Es un solo nodo; la concurrencia de 4/10/25 nodos corresponde a P1.3.
