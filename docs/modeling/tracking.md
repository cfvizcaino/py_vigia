# Seguimiento de vehículos sin fragmentar

## Problema

Un mismo vehículo se publicaba muchas veces. En las pruebas del 12/10/2026, el teléfono produjo 249 tracks en 6 minutos de un video con unos 30 vehículos por vuelta. La Tapo produjo 132 tracks en pocos minutos sobre un parqueadero con 9 autos quietos. Cada track nuevo es una fila en `detections`, así que la consulta veía al mismo auto muchas veces. Además, los tracks de vida corta no alcanzan a votar un color.

La causa era la misma en los dos nodos: un vehículo lejano o parcialmente tapado tiene una confianza que oscila alrededor de 0,35. Cuando bajaba de ese umbral se perdía, y al volver a subir nacía con otro id.

- **Nodo PC:** ByteTrack está pensado para resolver eso con su segunda asociación, que usa las detecciones débiles para mantener tracks existentes. Pero el nodo llamaba al detector con `conf=0.35`, así que esas detecciones nunca llegaban al rastreador.
- **Teléfono:** el rastreador era un IoU voraz. Solo usaba detecciones de 0,35 o más, olvidaba un track tras 6 cuadros (~1 s) y publicaba cualquier detección de un solo cuadro.

## Medición

`apps/vision/training/evaluate_tracking.py` mide sin etiquetas manuales:

- **tracks publicados**;
- **fragmentos**: tracks que nacen a menos de 5 s de que otro de la misma clase terminara, cerca de donde se vio por última vez. Es el mismo vehículo recreado;
- **tracks de menos de 2 s** y **vida mediana**.

Para el teléfono, `record` guarda las detecciones como las ve la app (320 px, ~6 análisis/s, desde 0,05). `apps/movil/tool/track_report.dart` pasa esas detecciones por el rastreador de la app y además reporta la **cobertura**: la fracción de detecciones de 0,35 o más que terminan dentro de un track publicado.

Videos (en `apps/vision/captures/`, fuera de Git):

- `video-placas-01.mp4`: 61 s de calle con tráfico.
- `tapo-parqueadero-01.mp4`: 90 s de la Tapo C110 sobre un parqueadero de noche, con 9 autos estacionados. Agrupando los tracks por posición, las dos configuraciones encuentran los mismos 9.

## Nodo PC

`vigia_vision/trackers/vigia-bytetrack.yaml` (configurable con `TRACKER`). El detector recibe `conf=0.1` y la publicación sigue exigiendo `YOLO_CONFIDENCE`:

| Parámetro | Antes | Ahora | Por qué |
|---|---|---|---|
| detecciones al rastreador | ≥ 0,35 | ≥ 0,1 | la segunda asociación necesita las débiles |
| `track_high_thresh` | 0,25 | 0,35 | solo las fuertes reviven tracks perdidos |
| `new_track_thresh` | 0,25 (en la práctica 0,35) | 0,35 | la misma exigencia para un vehículo nuevo: no se pierde cobertura |
| `track_buffer` | 30 cuadros | 90 cuadros | ~10-15 s a los 6-9 análisis/s del nodo |

Además, cada track publica la mejor confianza que alcanzó (las detecciones débiles no la bajan) y permanece 20 s en los snapshots, más que la memoria del rastreador.

| Video | Configuración | Tracks | Fragmentos | Menos de 2 s | Vida mediana |
|---|---|---:|---:|---:|---:|
| Calle | antes | 43 | 16 | 20 | 3,6 s |
| Calle | **ahora** | **35** | **10** | **9** | **5,4 s** |
| Parqueadero | antes | 41 | 21 | 21 | 1,9 s |
| Parqueadero | **ahora** | **12** | **2** | **0** | **84,8 s** |

Se descartaron variantes con `new_track_thresh` de 0,4 o 0,45. Dejaban menos tracks (27 en la calle, 5 en el parqueadero), pero porque dejaban de ver autos que nunca superan ese valor.

## Teléfono

`lib/edge_mode/tracker.dart` sigue ahora la lógica de ByteTrack con los mismos umbrales:

1. Las detecciones fuertes (≥ 0,35) se asocian con todos los tracks, incluso los perdidos hasta 10 s. Se comparan con la última caja y con la predicha según la velocidad del track (como máximo 2 s hacia adelante).
2. Las detecciones débiles (0,1–0,35) solo continúan tracks vistos en la actualización anterior.
3. Las detecciones fuertes sin asociar crean tracks tentativos. Se publican desde la segunda coincidencia y se descartan si la siguiente actualización no los ve.

| Rastreador | Tracks | Fragmentos | Menos de 2 s | Vida mediana | Cobertura |
|---|---:|---:|---:|---:|---:|
| antes | 106 | 80 | 72 | 0,7 s | 100 % |
| **ahora** | **35** | **2** | **5** | **4,7 s** | **98,3 %** |

(Calle, detecciones a 320 px y ~6 análisis/s.) La cobertura baja 1,7 puntos porque el primer cuadro de cada vehículo ahora espera a la confirmación; a cambio, los parpadeos de un cuadro ya no se publican. A 320 px, el detector del teléfono no ve los autos del parqueadero con 0,35 o más, así que esa escena no aplica al teléfono.

## Prueba en vivo (12/10/2026)

Mismas escenas que la prueba del color, antes y después del cambio, contadas en `edge_observations` de la central:

| Nodo | Rastreador | Duración | Tracks | Tracks/min | Vida media | Menos de 2 s | Con color |
|---|---|---:|---:|---:|---:|---:|---:|
| Teléfono frente al video | antes | 2,2 min | 163 | 74 | 5,2 s | 63 % | 55 % |
| Teléfono frente al video | **ahora** | 3,1 min | 71 | **23** | **22,7 s** | **14 %** | **86 %** |
| Tapo, parqueadero | antes | 8,9 min | 132 | 15 | 19 s | 38 % | 72 % |
| Tapo, parqueadero | **ahora** | 8 h | 106 | **0,2** | **> 1 h** | 30 % | 86 % |

El video tiene unos 30 vehículos por minuto, así que 23 tracks por minuto ya está cerca de uno por vehículo. En el parqueadero, los autos estacionados son un único track durante horas; los 106 tracks de 8 horas incluyen los que entraron y salieron con el tráfico del día. Como cada track vive más, alcanza a votar el color, y la cobertura de color sube.

## Reproducir

```bash
cd apps/vision
.venv/bin/python training/evaluate_tracking.py pc captures/tapo-parqueadero-01.mp4 \
    --tracker vigia_vision/trackers/vigia-bytetrack.yaml --conf 0.1
.venv/bin/python training/evaluate_tracking.py record captures/video-placas-01.mp4 --output /tmp/det.json
cd ../movil && dart run tool/track_report.dart /tmp/det.json /tmp/tracks.json
cd ../vision && .venv/bin/python training/evaluate_tracking.py metrics /tmp/tracks.json
```

## Límites

- Los fragmentos son una aproximación: no cuentan los vehículos que reaparecen lejos de donde se perdieron (por ejemplo, tras una oclusión larga) y pueden confundir dos vehículos distintos que pasan por el mismo punto con menos de 5 s de diferencia.
- Un vehículo que pasa tan rápido que solo aparece en un análisis no se publica en el teléfono (1,7 % de las detecciones fuertes en la prueba).
- Cada sesión del nodo empieza los ids de cero: al reiniciarlo, los autos estacionados se vuelven a publicar una vez.
