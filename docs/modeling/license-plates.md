# Estrategia para detectar y leer placas

## Decisión

VIGIA utilizará una tubería de tres etapas:

1. `YOLO26n` detecta y sigue vehículos.
2. Un `YOLO26n` ajustado con una sola clase (`plate`) busca la placa dentro del recorte del vehículo.
3. Un OCR especializado intenta leer únicamente los mejores recortes de cada track.

Separar las etapas evita pedirle al modelo COCO que reconozca una clase que no fue entrenada para detectar y reduce el área que debe examinar el OCR.

## Modelo general

Se adopta `yolo26n.pt` como nueva línea base para vehículos. Ultralytics documenta una arquitectura más ligera, asignación orientada a objetos pequeños y hasta 43 % de mejora en inferencia CPU **ONNX** frente a YOLO11n. Esa cifra no se asume para PyTorch ni para este equipo: se debe medir con video de la Tapo antes de fijar un objetivo de FPS.

Documentación: <https://docs.ultralytics.com/models/yolo26/>

## Detector de placas

No se incorpora automáticamente un peso comunitario `.pt`. Esos archivos usan serialización Pickle y deben considerarse código de terceros. Además, un modelo encontrado con métricas publicadas fue evaluado con solo 70 imágenes y no demuestra desempeño con placas colombianas.

El repositorio incluye:

- `apps/vision/training/train_plate_detector.py`, para ajustar YOLO26n;
- `apps/vision/training/plate-data.example.yaml`, como contrato mínimo del dataset;
- configuración opcional `PLATE_MODEL`, para cargar el peso resultante;
- captura privada de una placa por track en `outputs/plates`.

## Datasets recomendados

| Dataset | Uso recomendado | Limitación |
|---|---|---|
| Datos propios de la Tapo | Entrenamiento y evaluación final | Requiere consentimiento, anonimización, etiquetado y separación por escena/vehículo |
| UFPR-ALPR | Preentrenamiento y casos reales latinoamericanos | Placas brasileñas; 4.500 imágenes; solo investigación académica |
| CCPD | Robustez geométrica, desenfoque e inclinación | Placas y caracteres chinos; no representa el dominio colombiano |

Fuentes:

- UFPR-ALPR: <https://web.inf.ufpr.br/vri/databases/ufpr-alpr/>
- CCPD: <https://github.com/detectRecog/CCPD>

La división de datos propios debe hacerse por vehículo y por intervalo de captura, no aleatoriamente por frame. De otro modo, frames casi idénticos del mismo carro pueden quedar en entrenamiento y validación, inflando las métricas.

## OCR

La siguiente fase evaluará PaddleOCR sobre los recortes aceptados. PaddleOCR ofrece modelos PP-OCRv6 y reconocimiento de alfabetos latinos, pero añadirlo ahora duplicaría trabajo sin saber si la cámara produce suficientes píxeles de placa.

Antes del OCR se debe medir:

- ancho de la placa en píxeles;
- desenfoque por movimiento;
- ángulo e iluminación;
- precisión y recall del detector por distancia;
- exactitud de lectura completa, no solo por carácter.

Documentación: <https://www.paddleocr.ai/main/en/version3.x/pipeline_usage/OCR.html>

## Criterio para avanzar

Primero se recolectarán recortes reales sin texto OCR y se revisará visualmente si las placas son legibles. Si la placa no tiene suficiente resolución, ningún cambio de modelo recuperará de forma confiable caracteres que la cámara no capturó; será necesario acercar la cámara, usar `stream1`, reducir el ángulo o mejorar la iluminación.

## Avance del 13/10/2026: detector entrenado con recortes de vehículos

### Por qué fallaba el detector anterior

El nodo busca la placa **dentro del recorte de cada vehículo** (`vigia_vision/plates.py`: margen del 4 % e `imgsz=640`). Los modelos anteriores se entrenaron con **fotogramas completos** a 768–960 px. Una placa de un 4K quedaba de 3 a 10 px y a una escala distinta de la de inferencia. Evaluado sobre recortes de vehículos, el mejor modelo anterior (`pilot-phone-01-30e`) obtuvo **mAP50 0,000**.

### Datos

- **Video propio** `captures/placas.mp4`: 2 min en 4K de una calle residencial de Barranquilla, de día y con la cámara a la altura del peatón. Queda fuera de Git, como todos los datos con placas.
- **Fotogramas:** `training/prepare_video_frames.py` extrae uno cada 0,5 s (224 en total) y los separa por tiempo, con **4 s de hueco entre tramos** para que un vehículo no quede en dos splits:
  - entrenamiento: 0–82 s;
  - validación: 86–100 s;
  - prueba: 104–120 s.
- **Pre-etiquetado** con `training/prelabel_plates.py`:
  - vehículos con YOLO26n;
  - placas dentro de cada vehículo con el detector público `yolo-v9-s-608-license-plate-end2end` (paquete `fast-alpr`, MIT, solo ONNX, que no ejecuta código al cargarse);
  - lectura con `fast-plate-ocr`.
- **Revisión visual** en hojas de contacto:
  - se rechazaron **41 falsos positivos**: números de puerta de taxi, el número interno de un bus, adhesivos en el frente de motos, luces y fondo;
  - una segunda pasada con umbral bajo sobre los vehículos sin placa **recuperó 20 placas** omitidas;
  - resultado: **474 placas revisadas**. La traza de cada decisión queda en `review.json` de la fuente.
- **Dataset de recortes** con `training/build_plate_crops.py` (`vigia-plate-crops-v1`, junto con los 61 fotogramas 4K de `source_phone_01`):
  - cada muestra es un vehículo con el mismo margen que en inferencia;
  - se descartan los vehículos de menos de 150 px, los que tocan el borde del fotograma y los recortes que cortarían una placa;
  - los vehículos sin placa visible quedan como negativos.

| Split | Recortes | Placas |
|---|---:|---:|
| Entrenamiento | 996 | 820 |
| Validación | 43 | 31 |
| Prueba | 77 | 48 |

### Entrenamiento y resultado

`training/train_plate_detector.py`: YOLO26n desde los pesos COCO, `imgsz=640`, 30 épocas sin parada temprana (la validación es pequeña y ruidosa) y lote de 8. Tomó unas 4 h en CPU. Se usan los pesos finales, fijados de antemano. Quedan en `apps/vision/models/plate-detector.pt` y se activan con `PLATE_MODEL`.

| Modelo, conjunto de prueba | Precisión | Recall | mAP50 | mAP50-95 |
|---|---:|---:|---:|---:|
| Anterior (fotogramas completos) | 0,000 | 0,167 | 0,000 | 0,000 |
| **Nuevo (recortes de vehículos)** | **0,959** | **0,973** | **0,985** | **0,755** |

**Límite:** la prueba son otros vehículos de la misma escena y la misma cámara. Falta medirlo con otra cámara y otro ángulo (por ejemplo, la Tapo) antes de afirmar que generaliza.

### OCR: cuántos píxeles hacen falta

Se leyeron a mano 30 placas del tramo de prueba, todas con texto verificable por continuidad del vehículo. Se compararon cuatro modelos de `fast-plate-ocr` (lectura exacta de las 6 posiciones):

| Modelo | Total | ≥ 60 px | 45–59 px | 30–44 px |
|---|---:|---:|---:|---:|
| `cct-xs-v2-global-model` | 20/30 | **13/14** | **6/7** | 1/8 |
| `cct-s-v1-global-model` | **21/30** | 12/14 | **6/7** | 3/8 |
| `global-plates-mobile-vit-v2-model` | 16/30 | 7/14 | 6/7 | 3/8 |
| `cct-s-v2-global-model` | 15/30 | 8/14 | 5/7 | 2/8 |

(Ancho de la placa en píxeles del fotograma 4K.)

- **Con 45 px o más, el mejor modelo lee la placa completa en el 90 % de los casos** (19/21). Por debajo de 45 px cae a menos del 40 %.
- **La resolución sobre la placa pesa más que el modelo.** La cámara debe instalarse para que la placa mida al menos ~45 px: en este video, eso corresponde a vehículos a pocos metros.
- **Siguiente paso:** integrar `cct-xs-v2-global-model` en el nodo, leer solo las placas de 45 px o más y **votar la lectura por track** entre fotogramas, como el color. El texto viaja en `licensePlate` del Detection Envelope 1.1, que ya lo contempla.

Las placas son datos personales (Ley 1581): este documento reporta exactitudes y tamaños, nunca números de placa. Los fotogramas, las etiquetas y las lecturas quedan en `apps/vision/datasets/`, fuera de Git.
