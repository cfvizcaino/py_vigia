# Evidencia: sensibilidad del puntaje y de los umbrales (12/10/2026)

**Propósito:** sustentar los umbrales del estimador (velocidad 8–70 km/h, enlace máximo de 2 km, hueco distante desde 500 m) y los pesos del puntaje como parámetros de laboratorio medidos, no como constantes universales.

**Datos crudos:** [`sensibilidad-puntaje-20261012.json`](./sensibilidad-puntaje-20261012.json). Herramienta: `apps/backend/tools/scoring_sensitivity.py`.

**Método:** desde `RoutingConfig` por defecto se varía **un parámetro a la vez** y se evalúa el dataset sintético `scoring-v1` ([descripción](../operations/scoring-dataset.md)). El dataset tiene 14 trayectorias con verdad de terreno y tiempos de viaje = duración OSRM × U(1,05; 1,9). No se generó con los umbrales del algoritmo, así que no hay dependencia circular.

**Métricas:**
- recall@1 y recall@3;
- Jaccard medio del top-3;
- tasa de enlaces falsos en el top-3;
- controles: S06 (salto imposible) y S10 (solo ruido) no deben producir rutas.

## Resultados

| Grupo | Variante | recall@1 | recall@3 | Jaccard | Enlaces falsos | S06 rutas | S10 rutas |
|---|---|---:|---:|---:|---:|---:|---:|
| base | Configuración por defecto | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |
| velocidad | 3–70 km/h | 0.286 | 0.357 | 0.558 | 0.31 | 0 | 0 |
| velocidad | 12–70 km/h | 0.286 | 0.357 | 0.540 | 0.27 | 0 | 0 |
| velocidad | 8–50 km/h | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |
| velocidad | 8–90 km/h | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |
| velocidad | 8–120 km/h | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |
| enlace máximo | 1000 m | 0.143 | 0.214 | 0.518 | 0.25 | 0 | 0 |
| enlace máximo | 1500 m | 0.214 | 0.286 | 0.522 | 0.29 | 0 | 0 |
| enlace máximo | 3000 m | 0.214 | 0.357 | 0.547 | 0.28 | 0 | 0 |
| enlace máximo | 5000 m | 0.214 | 0.357 | 0.547 | 0.28 | 0 | 0 |
| hueco distante | desde 250 m | 0.286 | 0.357 | 0.606 | 0.32 | 0 | 0 |
| hueco distante | desde 1000 m | 0.286 | 0.357 | 0.582 | 0.22 | 0 | 0 |
| hueco distante | desde 2000 m | 0.214 | 0.286 | 0.557 | 0.41 | 0 | 0 |
| ablación | sin detection | 0.286 | 0.429 | 0.581 | 0.24 | 0 | 0 |
| ablación | sin time | 0.214 | 0.429 | 0.574 | 0.28 | 0 | 0 |
| ablación | sin appearance | 0.286 | 0.429 | 0.576 | 0.27 | 0 | 0 |
| ablación | sin road | 0.286 | 0.429 | 0.576 | 0.27 | 0 | 0 |
| pesos | iguales (0,25 c/u) | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |
| tolerancia temporal | sigma 0.35 | 0.357 | 0.429 | 0.555 | 0.26 | 0 | 0 |
| tolerancia temporal | sigma 1.0 | 0.286 | 0.429 | 0.576 | 0.26 | 0 | 0 |

## Lectura

Con 14 trayectorias, una trayectoria equivale a 0,071 de recall. Las diferencias de una trayectoria no son concluyentes.

- **Velocidad.** 8 km/h es el mínimo que no pierde recall@3 ni añade enlaces falsos. El máximo no se distingue entre 50 y 120 km/h porque el dataset no tiene trayectos legítimos rápidos; el control S06 (≈ 127 km/h) se rechaza en todas las variantes. El máximo de 70 km/h se justifica por la norma: 50 km/h urbanos según la Ley 2251 de 2022, art. 12, más un 40 % de margen por error de reloj y de distancia.
- **Enlace máximo.** 2 km es el mejor valor de los probados: menos distancia descarta tramos reales y más distancia agrega asociaciones espurias.
- **Hueco distante.** 500 m equilibra recall y enlaces falsos.
- **Pesos.** Solo la señal temporal cambia el recall@1 al anularla; las demás y la variante de pesos iguales no se distinguen en este dataset. Los pesos de detección, apariencia y vía siguen siendo hipótesis a calibrar con recorridos de campo (P1.1).
- **σ = 0,35** mejora el recall@1, pero no se adopta: se ajustaría y se evaluaría sobre el mismo y único dataset (sobreajuste). Queda como hipótesis para P1.1.

Reproducir:

```bash
cd apps/backend && PYTHONPATH=. .venv/bin/python tools/scoring_sensitivity.py --json /tmp/sensibilidad.json
```
