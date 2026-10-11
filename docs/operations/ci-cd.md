# CI/CD

```text
PR ──► CI: backend (Postgres real) · visión · web · compilación de imágenes
merge a main ──► CI ──► ghcr.io/cfvizcaino/vigia-{backend,web}:main  (+ sha-…)
                                   ▲
servidor Azure: timer cada 2 min ──┘ pull → migrar → reiniciar → salud → (si falla) volver atrás
```

## CI: `.github/workflows/ci.yml`

Se ejecuta en cada PR y en cada push a `main`, salvo cuando solo cambian `apps/movil/**` (tiene su propio flujo, `movil.yml`) o documentación.

| Trabajo | Qué comprueba |
|---|---|
| `backend` | `pytest` completo, incluido `test_postgres.py` (migraciones, zonas horarias, reintentos concurrentes), sobre un servicio `postgres:17.11-alpine` |
| `vision` | pruebas del nodo con `requirements-test.txt`, sin torch ni ultralytics (varios GB que las pruebas no cargan) |
| `web` | `eslint`, `tsc --noEmit`, pruebas unitarias y `next build` |
| `images` | compila las imágenes de backend y web. Publica en GHCR solo desde `main` (`main` y `sha-…`) o en una ejecución manual (solo `sha-…`) |

Los PR desde forks reciben un token de solo lectura y nunca publican imágenes.

## CD: despliegue por extracción

El repositorio es público. Con un runner autoalojado en la VM, cualquier PR ajeno podría intentar ejecutar código en el servidor. Por eso el servidor no recibe órdenes de GitHub: **descarga** las imágenes que CI publicó.

`infra/azure/autodeploy.sh` se ejecuta cada 2 minutos (`vigia-autodeploy.timer`, usuario `vigia`):

1. `docker compose pull` de backend y web. Si las imágenes no cambiaron, termina sin hacer nada.
2. Etiqueta las imágenes en uso como `vigia/<servicio>:previous`.
3. `python -m vigia_backend.migrate upgrade`.
4. `docker compose up -d` de backend y web, y espera hasta 120 s a que su HEALTHCHECK diga `healthy`.
5. Si falla la migración, el arranque o la salud, vuelve a `:previous` y marca esa versión como fallida. No la reintenta hasta que CI publique otra, para no reiniciar los servicios cada 2 minutos.

Cada despliegue queda en `/opt/vigia/deploy.log` con el commit (`org.opencontainers.image.revision`). Las caídas de GHCR solo van al journal (`journalctl -u vigia-autodeploy`).

Probado en local contra un registro propio: primer despliegue, sin cambios, versión sana, versión que no queda sana, migración rota, salto de la versión fallida y recuperación con una versión nueva.

### Regla para migraciones: solo expandir

Al volver atrás se restaura el código, no la base. Por eso cada migración debe ser compatible con el código anterior: agregar tablas, columnas que admitan nulos o índices. Para borrar o renombrar se hace en dos versiones: primero el código deja de usar la columna y en un despliegue posterior la migración la borra.

## Operación

```bash
H=vigia-5dfe.mexicocentral.cloudapp.azure.com
bash infra/azure/deploy.sh $H deploys      # últimos despliegues y errores recientes
bash infra/azure/deploy.sh $H pause        # congela la versión actual
bash infra/azure/deploy.sh $H resume
bash infra/azure/deploy.sh $H autodeploy   # (re)instala script y timer
ssh -i ~/.ssh/vigia_azure vigia@$H /opt/vigia/autodeploy.sh --force   # redesplegar ya
```

- **Fijar una versión:** `VIGIA_IMAGE_TAG=sha-abc1234` en `/opt/vigia/.env` y `docker compose up -d backend web`. El timer sigue esa etiqueta hasta que se quite.
- **Emergencia sin CI:** `pause`, compilar en el PC y `deploy.sh $H push`. Luego `resume` cuando `main` tenga el arreglo.
- **Infraestructura** (compose, Caddyfile, OSRM): `deploy.sh $H sync` y `deploy.sh $H up`. No es automática a propósito, porque un error ahí no tiene vuelta atrás automática.
- **App móvil:** `movil.yml` compila y prueba. El APK firmado se publica a mano (`deploy.sh $H apk …`), porque la llave de firma no está en GitHub.
