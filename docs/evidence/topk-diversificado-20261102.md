# Top-k diversificado (02/11/2026)

Hallazgo del dataset de puntajes (09/10): el top-k no diversificaba y en hora pico no recuperaba trayectorias. Se midió con `python -m vigia_backend.scoring_dataset evaluate` (dataset sintético 1.0.0, 14 trayectorias).

## Causa

1. **Subsecuencias.** Una cadena más larga ocultaba a su subsecuencia si su puntaje era mayor o igual. El bono de cobertura (+0,04 por paso) hacía ganar siempre a la versión alargada con la detección de otro vehículo del mismo color. En S07 (seis autos blancos) cuatro de las seis trayectorias reales no aparecían en ningún puesto, ni sin límite de candidatas.
2. **Copias del mismo vehículo.** Las variantes de una ruta (mismas detecciones, otro paso) ocupaban el top-k y empujaban fuera a los demás vehículos.

## Cambio (`routing.py`, `selection: diversified-v1`)

- Una cadena oculta a su subsecuencia solo si la media geométrica de sus tramos, **sin el bono**, es igual o mejor.
- Primero se listan las mejores rutas que no comparten detecciones (cada una, un vehículo distinto); después se completan con alternativas en orden de puntaje. Cada alternativa indica `shares_with_rank`, y la consola lo explica.

Se compararon doce variantes: regla actual, media geométrica con margen 0 y 0,02, sin regla × selección voraz, disjunta primero y MMR con λ 0,3 y 0,6. La elegida fue la mejor en recall@3, recall@5 y enlaces falsos a la vez.

| Métrica | Antes | Después |
|---|---:|---:|
| recall@1 | 0,286 | 0,286 |
| recall@3 | 0,429 | **0,571** |
| recall@5 | 0,429 | **0,714** |
| Jaccard medio top-3 | 0,592 | **0,719** |
| Enlaces falsos top-3 | 0,240 | **0,167** |

Por caso: S02 lleva a los dos autos plateados al top-3 (antes, puestos 2 y 6), S04 (cámara sin detección) pasa de no aparecer al puesto 2 y S07 recupera dos autos dentro del top-4. Costo: S05 (parada larga) baja del puesto 3 al 5.

## Límite

recall@1 no cambia. En hora pico los tramos verdaderos y los cruzados puntúan casi igual (≈0,8): con solo hora, color y red vial no hay forma de separarlos. Para eso están la placa (dos placas distintas ya no se unen) y la confirmación del admin sobre los recortes. Todo es sobre datos sintéticos; falta la evaluación independiente P1.1 con recorridos reales.
