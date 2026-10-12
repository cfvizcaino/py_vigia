# Color del vehículo

## Por qué antes salía "desconocido"

El detector (`yolo26n`, entrenado con COCO) solo entrega la clase (auto, moto) y la caja. Ninguna etapa calculaba el color: el nodo PC y el teléfono enviaban `color: null` en cada detección. Como las consultas filtran por igualdad (`detections.color = 'white'`), un filtro de color no encontraba nada y había que buscar con "Todos los colores".

## Decisión

Una segunda etapa clasifica el color sobre el recorte de cada vehículo seguido:

1. `yolo26n` detecta y sigue los vehículos (sin cambios).
2. `yolo26n-cls`, ajustado con fotos de vehículos por color, clasifica el recorte de cada track.
3. Cada track acumula las probabilidades de hasta 5 recortes, tomados con al menos 0,5 s de separación. Reporta el color con mayor promedio solo si hay 2 votos o más y ese promedio llega a 0,5. Si no, el color queda en `null`.

Votar entre cuadros evita que un reflejo, una sombra o un cuadro desenfocado decidan el color. Dejar el color en `null` ante la duda es intencional: un color equivocado esconde el vehículo en una consulta filtrada, mientras que uno desconocido solo pierde el filtro. La reconstrucción de rutas ya trata el color desconocido como una coincidencia débil (`appearance = 0.4`), no como un descarte.

La misma regla corre en el nodo PC (`apps/vision/vigia_vision/colors.py`) y en el teléfono (`apps/movil/lib/edge_mode/colors.dart`).

Se descartó una heurística por píxeles (histograma HSV del recorte). No requiere entrenamiento, pero confunde el color del vehículo con el pavimento, los vidrios y los reflejos, y su exactitud no se puede medir contra un conjunto de prueba.

## Vocabulario

`black`, `blue`, `brown`, `gray`, `green`, `red`, `white`, `yellow`.

- `gray` agrupa gris y plateado. Con luz real no se separan de forma fiable y el dataset no los distingue.
- Naranja, rosado y morado se excluyeron: tienen muy pocos ejemplos (29, 164 y 135) y son raros en el parque automotor. Un vehículo de esos colores suele quedar con color `null` o con el más cercano.
- La consola web y la app solo ofrecen estos 8 colores en el filtro, y muestran "Gris o plateado".

## Datos

[`WandererGuy/vehicle-color-classification-dataset`](https://huggingface.co/datasets/WandererGuy/vehicle-color-classification-dataset) en Hugging Face: unos 5 800 recortes de autos, motos, buses y camiones en 11 colores, muchos de cámaras de vigilancia. No declara licencia, así que se usa solo para investigación y no se redistribuye: queda fuera de Git en `apps/vision/datasets/colors/`.

`training/build_color_dataset.py` unifica nombres (`grey` → `gray`, `silver` → `gray`), descarta duplicados exactos (72) y recortes con un lado menor de 24 px (406), y reparte 80/10/10 por color de forma reproducible:

| Color | train | val | test |
|---|---:|---:|---:|
| black | 780 | 97 | 97 |
| blue | 446 | 56 | 56 |
| brown | 119 | 15 | 15 |
| gray | 551 | 69 | 69 |
| green | 187 | 23 | 23 |
| red | 903 | 113 | 113 |
| white | 768 | 96 | 96 |
| yellow | 212 | 26 | 26 |

### Recortes del sitio

El modelo entrenado solo con datos públicos confundía los autos plateados de las calles de VIGIA con blancos: el dataset casi no tiene plateados a plena luz desde arriba. Para ajustarlo se recortaron vehículos de los videos propios (`apps/vision/captures/`, fuera de Git) con `training/site_color_crops.py`:

1. `extract` detecta y sigue los vehículos, guarda hasta 3 recortes por track y propone un color con el modelo vigente.
2. Las propuestas se revisaron a mano en hojas de contacto: de 199 tracks se etiquetaron 155 y se descartaron 44 dudosos (motos donde domina la ropa del conductor, vehículos tapados por señales, recortes oscuros). El modelo vigente coincidía con la etiqueta en solo 85 de los 155.
3. Los tracks del último 30 % de cada video forman la **prueba de sitio** (46 vehículos, 95 recortes) y nunca entran a entrenamiento. Separar por tiempo evita que el mismo vehículo quede a ambos lados.

`build_color_dataset.py` respeta los splits de las fuentes que los traen, así que la versión 2 suma 238 recortes del sitio a `train` y deja intactos `val` y `test` de los datos públicos.

### VCoR

[VCoR](https://www.kaggle.com/datasets/landrykezebou/vcor-vehicle-color-recognition-dataset) (Kaggle, licencia "Data files © Original Authors"): 10 373 fotos en 15 colores, ya separadas en train, val y test. Se descarga a mano con una cuenta de Kaggle, se usa solo para investigación y queda fuera de Git en `apps/vision/datasets/colors/vcor/`. Aporta unos 520 plateados y 610 grises, justo lo que le faltaba al modelo. Se conservan sus splits. `silver` y `grey` pasan a `gray`, y se excluyen beige, dorado, café claro (tan), naranja, rosado y morado.

La versión 3 (`vigia-colors-v3`) reúne las tres fuentes: 8 874 imágenes de entrenamiento, 1 491 de validación y 1 588 de prueba.

## Entrenamiento

`training/train_color_classifier.py`: `yolo26n-cls` preentrenado, entrada de 128 px, CPU.

Las aumentaciones por defecto de Ultralytics cambian el tono y aplican RandAugment (posterizar, solarizar, ecualizar). En un clasificador de color eso equivale a cambiar la etiqueta, así que se desactivan: `hsv_h=0`, `auto_augment=None` y poca saturación (`hsv_s=0.15`). Se mantienen el brillo y el contraste (`hsv_v=0.4`), que sí varían entre cámaras, horas y clima, además del volteo horizontal y el recorte aleatorio.

## Resultados

Exactitud por recorte (top-1). Los pesos se fijan de antemano para no elegir mirando la prueba: v1 usa la mejor época según validación, y v2 y v3 los pesos finales de una corrida completa de 20 épocas. **El modelo desplegado es v3.**

| Modelo | Pública (495) | VCoR (998) | Sitio (95) | Gris en el sitio |
|---|---:|---:|---:|---:|
| v1: solo datos públicos | 86,3 % | — | 63,2 % | 25 % |
| v2: públicos + sitio | 86,5 % | 79,5 % | 82,1 % | 88 % |
| **v3: públicos + sitio + VCoR** | **87,7 %** | **94,5 %** | **91,6 %** | **94 %** |
| v3 en TFLite con el preprocesado de la app | 87,3 % | 94,4 % | 90,5 % | — |

En la prueba de sitio, v3 acierta 100 % en rojo y amarillo, 94 % en gris, 89 % en blanco y 75 % en negro (v2: 88 %, 74 % y 50 %). En la prueba pública, el gris sube de 59 % (v1) a 81 %. Bajan blanco (de 88 % a 82 %) y café (de 87 % a 80 %, sobre solo 15 fotos).

Antes de la votación, descartar las predicciones con confianza menor a 0,7 deja a v3 en 93 % en el sitio y conserva el 95 % de los recortes. La votación entre cuadros va en la misma dirección.

El preprocesado importa: con vecino más cercano en lugar del bilineal con antialiasing que usa el entrenamiento, el TFLite de v1 bajaba de 87,1 % a 83,2 % en la prueba pública. La app replica el filtro de PIL (`prepareCrop` en `preprocess.dart`, verificado contra PIL en las pruebas).

La prueba de sitio es pequeña (46 vehículos) y viene de las mismas dos escenas que los recortes de entrenamiento, aunque con vehículos distintos. Mide la adaptación a esas cámaras, no a una cámara nueva.

Una corrida de 30 épocas sin parada temprana sobre los datos públicos no superó a v1 (87,1 % frente a 88,1 % en validación): la validación de unas 500 imágenes oscila de 2 a 4 puntos por época.

## Despliegue

- **Teléfono:** `assets/models/colors.tflite` (float32, exportado con `training/export_mobile.py`, que ahora acepta clasificadores). Hace como máximo 3 recortes por cuadro, solo de los tracks que aún necesitan votos, en un proceso auxiliar. Si el modelo no carga, la detección sigue y el color se reporta desconocido.
- **Nodo PC:** `apps/vision/models/vehicle-colors.pt`, configurable con `COLOR_MODEL` (vacío lo desactiva). Ultralytics redimensiona y recorta cada recorte igual que en el entrenamiento.
- **Backend y contrato:** el campo `color` ya existía en el Detection Envelope 1.1 y en la tabla `detections`. El único cambio es en la ingesta: un sobre que llega sin color (porque la votación del track aún no termina) ya no borra el color guardado; un color distinto sí lo corrige.

## Pruebas en vivo (12/10/2026)

- **Teléfono (CEL-02, APK 1.2.0, modelo v2) frente a un monitor con `video-placas-01.mp4`:** 249 detecciones en 6 minutos, 151 con color (61 %). La mezcla de colores (sobre todo blanco y gris, además de rojos, taxis amarillos, negros y azules) coincide con el video. Con la calle de noche, en cambio, solo el 18 % tuvo color.
- **Tapo C110 (CAMERA-1, nodo PC, modelo v3) sobre un parqueadero iluminado de noche:** 86 detecciones, 59 con color (69 %). Los dos tracks que se compararon con el cuadro en vivo tenían el color correcto. Con la clasificación de color, el nodo pasa de unos 10 a unos 6 cuadros por segundo.

En ambas pruebas, la mayoría de los "desconocidos" vienen del seguimiento y no del clasificador. Los vehículos lejanos o quietos con confianza baja se pierden y renacen como tracks nuevos, que no alcanzan los 2 votos separados 0,5 s. Eso también duplica filas en `detections`. Ver [seguimiento sin fragmentar](tracking.md), que lo corrige.

## Límites

- De noche y con luz infrarroja, la cámara ve en escala de grises; se espera `gray`, `black`, `white` o `null`.
- Los vehículos lejanos (caja con un lado menor de 24 px) no se clasifican.
- El dataset tiene pocos ejemplos de café y verde, que son los colores con menor exactitud esperada.
- La cobertura depende del seguimiento: los tracks de vida corta quedan sin color (ver las pruebas en vivo).
- Cada cámara nueva debería aportar recortes propios: `site_color_crops.py` hace el flujo completo (extraer, revisar, construir, reentrenar).
