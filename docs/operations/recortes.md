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

Respuestas de la subida: `201` guardado; `404` el track no existe (no reintentar); `413` más de 64 KB; `415` no es JPEG; `401/403` token inválido o de otra cámara; `503` el centro no guarda recortes (dejar de enviarlos).

## Puesta en marcha (una vez)

```bash
H=vigia-5dfe.mexicocentral.cloudapp.azure.com
az login
bash infra/azure/deploy.sh $H recortes   # cuenta, contenedor, borrado a 7 días y cadena en .env
bash infra/azure/deploy.sh $H sync       # compose con las variables THUMBNAIL_*
bash infra/azure/deploy.sh $H up
```

Sin `THUMBNAIL_STORAGE_CONNECTION_STRING` el backend responde `503` a los recortes y todo lo demás sigue igual. En desarrollo, `compose.yaml` usa una carpeta local (`THUMBNAIL_DIR`).

Costo esperado: unos 10 KB por track. Un edge con tráfico intenso (≈1 400 tracks/h, como CEL-04 el 28/10) genera ≈14 MB/h; con 7 días de retención, menos de 3 GB por edge en operación continua, del orden de centavos de dólar al mes en Standard LRS.

## Fases

1. **Centro (esta fase):** almacén, subida, vista de admin, retención.
2. **Teléfono:** recortar y subir un JPEG por track desde el edge autónomo.
3. **Confirmación:** en consola y app, el admin marca cada paso como "es este" / "no es este" y la ruta se recalcula.
4. **Aprendizaje:** las confirmaciones alimentan el conjunto de puntaje (`scoring_dataset.py`) y los recortes corregidos el reentrenamiento de color por cámara.
