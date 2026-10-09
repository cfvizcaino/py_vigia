# Prueba de resiliencia edge → centro (P1.2)

`infra/resilience/run.py` reproduce las fallas que el piloto va a encontrar y comprueba en la base que ningún evento se pierda ni se duplique. Corre contra el stack Compose real: backend en contenedor y PostgreSQL. Usa el **publicador real del nodo** (cola en disco, reintentos y timeout de 10 s); lo único simulado son los snapshots, que reemplazan a la cámara y a YOLO con la misma cadencia de 2 s y el mismo contrato 1.1.

```text
nodo simulado ──► cola en disco ──► proxy de fallas ──► backend-resilience ──► PostgreSQL
 (snapshots 2 s)   (publicador real)   (corte / acuses perdidos)   (contenedor)      (vigia_resilience)
```

## Fases

| Fase | Qué se simula | Qué se espera |
|---|---|---|
| Base (60 s) | Red normal | Entrega inmediata |
| Corte de red (300 s) | El proxy retiene las conexiones sin responder, como un enlace caído | La cola crece y nada se pierde |
| Reinicio del nodo | A mitad del corte el nodo se detiene con la cola llena y arranca con una sesión nueva | La cola sobrevive al reinicio y ambas sesiones se entregan |
| Acuses perdidos (40 s) | El backend guarda el evento pero la respuesta no llega al nodo | El nodo reenvía; el backend responde `duplicate`; ninguna fila extra |
| Caída del backend (15 s) | Contenedor detenido | Reintentos hasta que vuelve |
| Caída de PostgreSQL (15 s) | Base detenida; el backend responde 5xx | El pool se reconecta solo y la cola drena |

Al final consulta `vigia_resilience` y compara evento por evento. Aprueba solo si se cumplen todas estas condiciones:
- cada evento generado está guardado exactamente una vez, sin faltantes ni sobrantes;
- cada track generado produjo exactamente una observación;
- el nodo no rechazó ningún evento.

## Ejecutar

```bash
docker compose exec db psql -U vigia -d vigia -c "CREATE DATABASE vigia_resilience"   # una vez
docker compose --profile resilience run --rm backend-resilience python -m vigia_backend.migrate upgrade
docker compose --profile resilience up -d backend-resilience
apps/backend/.venv/bin/python infra/resilience/run.py --outage 300 --output docs/evidence/p12-resiliencia-AAAAMMDD.json
```

Con el Docker rootless del proyecto, anteponer `VIGIA_COMPOSE="bash infra/docker-local.sh compose"`. La prueba dura unos 10 minutos.

El script registra la cámara `RES-01` en `vigia_resilience` y emite una credencial de un día. **La caída de PostgreSQL detiene el contenedor compartido**, así que el piloto y la consola de pruebas también pierden la base durante 15 s; no correr con tráfico real.

## Qué mide

- Eventos generados, guardados, faltantes, sobrantes y rechazados.
- Profundidad máxima de la cola y profundidad al volver la red.
- Drenaje: segundos desde que la falla termina hasta que sale de la cola todo lo generado antes.
- Latencia (recepción − generación) por fase, p50/p95/máx.
- Respuestas observadas por el proxy, duplicados reconocidos y reintentos del publicador.

## Límites

- No reemplaza la sesión prolongada con la cámara física ni la prueba entre redes reales por VPN (P0.1 y P0.2).
- El corte se simula en el proxy, en la misma máquina; no mide pérdida de paquetes ni latencia de enlaces reales.
- La carga es de un solo nodo; la prueba de 4/10/25 nodos corresponde a P1.3.
