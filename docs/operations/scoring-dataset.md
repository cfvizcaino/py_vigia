# Dataset sintético de puntajes y rutas

`apps/backend/datasets/scoring/scoring-v1.json` es un escenario **sintético y versionado** para probar el ranking de trayectorias: qué ruta sale primero, con qué puntaje y cuándo se enlazan detecciones que no deberían. No son recorridos reales ni sirven para calibrar pesos; esa evaluación (P1.1) necesita recorridos de campo.

## Contenido

- 8 cámaras `SC-01`…`SC-08` ajustadas a calles del extracto OSM validado (a menos de 50 m de la vía).
- 56 enlaces dirigidos con hasta 3 alternativas OSRM y su geometría. Las calles de un sentido producen distancias asimétricas (SC-01→SC-02 354 m, SC-02→SC-01 776 m).
- 18 vehículos con verdad de terreno y 111 detecciones, incluido ruido de fondo, el 15/09/2026 desde las 07:00 de Colombia. Cada escenario ocupa un bloque de 20 minutos.
- Tiempos de viaje: duración OSRM × factor de tráfico aleatorio U(1,05; 1,9), con semilla fija `20260915`.

| Caso | Escenario | Qué prueba |
|---|---|---|
| S01 | Recorrido limpio | Control: debe salir primero |
| S02 | Dos autos plateados que se cruzan | Confusión entre vehículos iguales |
| S03 | Moto sin color detectado | Apariencia incompleta |
| S04 | Cámara intermedia sin detección | Observación perdida |
| S05 | Parada de 8 minutos | Tiempo atípico |
| S06 | Dos autos verdes a ~127 km/h equivalentes | No debe enlazar |
| S07 | Hora pico: seis autos blancos | Densidad |
| S08 | Confianza 0,35–0,5 | Detector débil |
| S09 | Auto gris en sentido contrario plausible | Vía de un sentido |
| S10 | Solo ruido | No debe inventar rutas |

## Evaluar sin base de datos

```bash
cd apps/backend
python -m vigia_backend.scoring_dataset evaluate [--json informe.json]
```

Usa la misma selección que la API (radio, ventana y filtros) y `RoutingConfig` por defecto. Métricas:

- **recall@k**: fracción de trayectorias reales cuya secuencia exacta aparece entre las k primeras rutas.
- **Jaccard top-3**: solapamiento de detecciones con la mejor ruta del top 3 (aciertos parciales).
- **Enlaces falsos**: pares consecutivos del top 3 que unen detecciones de vehículos distintos o ruido.

### Resultado de referencia (v1.0.0, 08/10/2026)

14 trayectorias: recall@1 **0,286**, recall@3 **0,429**, Jaccard medio **0,576**, enlaces falsos **0,26**.

- Funcionan: el recorrido limpio y el de baja confianza salen primeros; el salto imposible y el ruido no producen rutas; la moto sin color se reconstruye.
- Hallazgo principal (S07, S02): el ranking devuelve una lista global y las 10 posiciones se llenan con variaciones del par más fuerte. Una misma detección puede aparecer en varias rutas, así que otros vehículos no llegan al top. En hora pico ninguna de las 6 trayectorias aparece completa.
- S05: una alternativa vial larga hace pasar una parada de 8 minutos por circulación lenta (>8 km/h) y la ruta se enlaza.
- S04 y S09: el ruido del mismo color se une a la trayectoria real.

Propuestas a discutir, sin implementar: diversificar el top-k (no repetir el mismo prefijo o la misma detección), una asignación exclusiva de detecciones entre trayectorias y una penalización de tiempo para alternativas mucho más largas que la principal.

`tests/test_scoring_dataset.py` comprueba la integridad del archivo y que los casos de control (S01, S06, S08, S10) no empeoren al cambiar pesos o código.

## Verlo en la consola

El perfil `scoring` levanta un backend y una web aparte, sobre la base `vigia_scoring`, sin tocar los datos del piloto:

```bash
docker compose exec db psql -U vigia -d vigia -c "CREATE DATABASE vigia_scoring"   # una vez
docker compose --profile scoring run --rm backend-scoring python -m vigia_backend.migrate upgrade
docker compose --profile scoring run --rm backend-scoring python -m vigia_backend.scoring_dataset load --confirm-database vigia_scoring
docker compose --profile scoring run --rm backend-scoring python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
docker compose --profile scoring up -d
```

Abrir <http://127.0.0.1:3200>, iniciar sesión y usar **Caso del dataset de pruebas**, debajo del formulario: llena cámara, fecha, horario, radio y filtros del caso; luego **Buscar coincidencias**. El backend publica los casos en `GET /api/v1/scenarios` solo cuando la base tiene cámaras `SC-`; en el piloto la lista está vacía y el selector no aparece.

`load` reemplaza todo el contenido de la base indicada. Por seguridad exige que el nombre contenga `scoring`, que se confirme con `--confirm-database`, y que la base no tenga cámaras reales ni eventos de nodos. La cookie de sesión de esta consola es distinta (`vigia_scoring_session`), así que puede usarse a la vez que la del piloto.

## Nueva versión

`generate` no sobrescribe archivos: para cambiar escenarios, editar `SCENARIOS` y generar `scoring-v2.json` contra el OSRM local (`--output`). Si cambia el grafo OSRM, también cambian distancias y tiempos, así que se debe versionar.
