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
