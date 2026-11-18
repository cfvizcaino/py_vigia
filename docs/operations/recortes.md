# Recortes de vehículos para confirmar rutas

Sugerido por los tutores tras la prueba de campo del 28/10/2026. Con mucho tráfico del mismo color, el color, la hora y la red vial no distinguen qué carro blanco es el buscado. Un recorte por detección permite que un **admin** confirme a mano si cada paso de una ruta corresponde al vehículo.

## Decisiones

| Tema | Decisión |
|---|---|
| Qué se guarda | Un JPEG pequeño por track (≤ 64 KB), solo la caja del vehículo; nunca la escena completa ni video |
| Dónde | Contenedor privado `recortes` de Azure Blob (cuenta `vigia5dferecortes`, México Central, mismo grupo `vigia-rg`). En la base, `detections.thumbnail_url` guarda solo la clave del objeto, no una URL pública |
| Cuánto tiempo | 7 días. El backend deja de servirlo a los 7 días exactos y olvida la clave; la regla de ciclo de vida de Azure borra el objeto entre el día 7 y el 8 (corre una vez al día) |
| Quién lo ve | Solo `admin`, a través de `GET /api/v1/detections/{id}/thumbnail`. Cada vista se registra en `security_audit` (`thumbnail.viewed`). La respuesta lleva `Cache-Control: private, no-store` |
| Quién lo sube | El edge, con su token de dispositivo de siempre. Las claves de Azure no salen del servidor |

Un recorte puede mostrar la placa o personas: es dato personal (Ley 1581). Por eso el contenedor no es público, el plazo es corto y el acceso queda auditado.

## Flujo

1. El edge publica el sobre que crea el track (Detection Envelope 1.1, sin cambios).
2. Después sube el recorte: `POST /api/v1/ingest/thumbnails?cameraId=…&sessionId=…&trackId=…&firstSeen=…` con `Content-Type: image/jpeg` y `X-Vigia-Device-Token`. `firstSeen` es el mismo valor del sobre.
3. El backend lo guarda como `CAMARA/SESION/TRACK-MILISEGUNDOS.jpg`. Un reintento sobrescribe el mismo objeto.
4. Las rutas de una consulta marcan cada paso con `has_thumbnail`; el admin pide el recorte por id de detección.

Respuestas de la subida: `201` guardado; `404` el track no existe (no reintentar); `413` más de 64 KB; `415` no es JPEG; `401/403` token inválido o de otra cámara; `501` el centro no guarda recortes (dejar de enviarlos). Un `503` es sobrecarga y se reintenta.

## Puesta en marcha (una vez)

```bash
H=vigia-5dfe.mexicocentral.cloudapp.azure.com
az login
bash infra/azure/deploy.sh $H recortes   # cuenta, contenedor, borrado a 7 días y cadena en .env
bash infra/azure/deploy.sh $H sync       # compose con las variables THUMBNAIL_*
bash infra/azure/deploy.sh $H up
```

Sin `THUMBNAIL_STORAGE_CONNECTION_STRING` el backend responde `501` a los recortes y todo lo demás sigue igual. En desarrollo, `compose.yaml` usa una carpeta local (`THUMBNAIL_DIR`).

Costo esperado: unos 10 KB por track. Un edge con tráfico intenso (≈1 400 tracks/h, como CEL-04 el 28/10) genera ≈14 MB/h; con 7 días de retención, menos de 3 GB por edge en operación continua, del orden de centavos de dólar al mes en Standard LRS.

## En el teléfono (app 1.4.0)

El edge autónomo guarda la vista más grande de cada vehículo y la envía una sola vez:

- **Qué recorte:** la caja con un 10 % de margen, derecha, con el lado mayor en 224 px como máximo (cada píxel promedia un bloque del cuadro) y JPEG de calidad 80, unos 10 KB. Solo se toma con lados de al menos 32 px y se vuelve a tomar si la caja crece un 20 %, hasta 4 veces por vehículo y una por cuadro analizado, en un proceso auxiliar para no frenar la detección.
- **Cuándo se envía:** cuando la vista deja de mejorar: el vehículo lleva 1 s sin verse, ya se tomaron 4 recortes o lleva 10 s en cuadro (un carro parqueado). También al detener el edge.
- **Cola:** el recorte entra a la misma cola en disco que los sobres, justo detrás del sobre que publica su track, así que sobrevive a cortes de red y el centro ya conoce el track cuando llega. Si la cola pasa de 500 archivos se omiten los recortes: los sobres van primero.
- **Respuestas:** `404`, `413` o `415` descartan ese recorte; `501` deja de enviar recortes en esa sesión; `503`, `401/403` y fallos de red se reintentan como los sobres.
- La pantalla del edge muestra los recortes enviados, descartados y fallidos.

## En el nodo PC (02/11)

El nodo Python (Tapo por RTSP, webcam, teléfono como cámara IP) sigue la misma regla que el teléfono: la vista más grande de cada vehículo publicado, con margen del 10 %, lado mayor ≤ 224 px y JPEG de calidad 80. Se reenvía si la caja crece un 20 %, con un máximo de 4 tomas. Se envía cuando el vehículo lleva 1 s sin verse, al completar 4 tomas o tras 10 s en cuadro.

El recorte va en la cola en disco justo detrás del sobre que publicó su track. Con más de 500 archivos pendientes se omite. Las respuestas `404`, `413`, `415` y `501` lo borran sin guardar la imagen (`501` además apaga los recortes en esa sesión); el resto se reintenta. `THUMBNAILS_ENABLED=0` lo apaga.

## Fases

1. **Centro:** almacén, subida, vista de admin, retención. En producción desde el 28/10.
2. **Edges:** recortar y subir un JPEG por track desde el teléfono (app 1.4.0) y, desde el 02/11, desde el nodo PC.
3. **Confirmación:** en la consola web desde el 02/11 (la app queda pendiente). En la vista de trayectoria, el admin ve el recorte y la placa de cada paso y responde «¿Es este el vehículo que buscas?». `PUT /api/v1/queries/{id}/confirmations/{detección}` con `match` o `reject` (y `DELETE` para deshacer) guarda la respuesta en `detection_confirmations`, la audita (`detection.confirmed`) y recalcula las rutas de esa misma consulta: lo rechazado sale de todas y lo confirmado debe estar en todas. La exportación sigue las rutas recalculadas.
4. **Aprendizaje (desde el 18/11):** al abrir un paso, el admin ve «Etiquetar para entrenamiento» y puede guardar el **color real** (uno de los 8, o «No se distingue») y la **placa** (texto exacto, «Ilegible» o «Sin placa visible»). Solo esa acción explícita copia el recorte al contenedor privado `aprendizaje` y crea la etiqueta; `match/reject` sigue siendo solo para rutas. Detalle en [Aprendizaje con recortes](#aprendizaje-con-recortes-fase-4).

## Aprendizaje con recortes (fase 4)

| Tema | Decisión |
|---|---|
| Qué se etiqueta | Color (8 colores o `no_determinable`) y placa (texto exacto, `ilegible` o `sin_placa`), cada una por separado. No revisar no es aceptar la predicción |
| API (solo admin) | `GET /api/v1/detections/{id}/annotations`, `PUT …/annotations/{color\|plate}` con `{"label": …}`, `DELETE` para deshacer, `GET /api/v1/admin/annotations/summary` |
| Dónde | Contenedor privado `aprendizaje` en la misma cuenta (`vigia5dferecortes`); la regla de 7 días solo filtra `recortes/`. El backend lo crea la primera vez. En local, `DATASET_DIR` |
| Cuánto tiempo | `DATASET_RETENTION_DAYS` = 180 mientras los tutores aprueban la política. La limpieza horaria borra la fila y la imagen |
| Qué guarda | Etiqueta, predicción original, confianza de la detección, `model_digest` (si el sobre crudo sigue), cámara, track, hora, autor y hash de la imagen. Sobrevive aunque la detección se borre |
| Auditoría | `annotation.saved` / `annotation.deleted`, con la tarea y si corrigió la predicción; nunca el texto de la placa |

### Exportar, entrenar y evaluar

```bash
# En el servidor: versión inmutable (falla si la carpeta existe)
docker compose exec backend python -m vigia_backend.training_export --task color --output /app/data/exports/colores-2026-11-18
# En el equipo de entrenamiento: sumar la exportación al dataset base, entrenar y evaluar
.venv/bin/python training/build_color_dataset.py datasets/colors/vigia-colors-v1 exports/colores-2026-11-18 --output datasets/colors/vigia-colors-v2
.venv/bin/python training/train_color_classifier.py --data datasets/colors/vigia-colors-v2 --name colores-v2
.venv/bin/python training/evaluate_color_annotations.py --data exports/colores-2026-11-18 \
    --candidate runs/vigia-colors/colores-v2/weights/best.pt --baseline models/vigia-colors.pt --report reporte.json
```

- La exportación reparte por **cámara + día** con un hash estable: un grupo cae siempre en el mismo split, así que la prueba queda congelada y nunca se mezcla un mismo paso entre entrenamiento y prueba. `build_color_dataset.py` respeta esos splits.
- `evaluate_color_annotations.py` mide solo el split `test`: exactitud, macro-F1, F1 por color y exactitud por cámara, frente a lo que predijo el edge en su momento o frente a los pesos en producción. Propone el candidato solo si sube el macro-F1 y ninguna cámara cae más de 5 puntos. El reporte guarda el digest de cada peso y la huella del dataset.
- Despliegue: el modelo nuevo se exporta con `export_mobile.py`, se prueba primero en un teléfono (canary) comparando su reporte y sus análisis/s con los demás, y se conserva el anterior para volver atrás.

**Pendiente:** el recorte de 224 px sirve para color, pero no basta para entrenar el lector de placas (falla con placas menores de 45 px). Las etiquetas de placa ya sirven para **evaluar** el OCR y como negativos (`sin_placa`) del detector. Para entrenarlo, el edge tendría que enviar un recorte de placa de mayor resolución.
