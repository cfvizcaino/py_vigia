# PostgreSQL para el piloto

Desde octubre de 2026 el despliegue con Compose usa PostgreSQL 17 en un contenedor propio (`db`). SQLite sigue disponible para desarrollo rápido y para la suite de pruebas en memoria, pero no para el piloto.

## Por qué Postgres, y por qué en Docker

| Necesidad del piloto | SQLite | PostgreSQL |
|---|---|---|
| Varias cámaras publicando a la vez | Un solo escritor; bloquea la base en cada escritura | Concurrencia por fila |
| Respaldo sin detener el servicio | Copia del archivo con cuidado | `pg_dump` en caliente |
| Más de una instancia del backend | No | Sí |
| PostGIS cuando haga falta | No | Cambio de imagen, sin migrar datos |

Se descartó Supabase para el piloto: las detecciones asocian vehículo, ubicación y hora (datos personales, Ley 1581 de 2012) y alojarlas allí implica un tercero y transferencia internacional; además el plan gratuito pausa proyectos inactivos y el centro dependería de su salida a internet. El contenedor mantiene la misma postura que la VPN y OSRM autogestionados: datos dentro del despliegue, puertos solo en loopback.

## Puesta en marcha

1. Crear la contraseña en `.env` de la raíz (ignorado por Git). Debe ser URL-safe porque va dentro de `DATABASE_URL`:

   ```bash
   (umask 077 && printf 'VIGIA_DB_PASSWORD=%s\n' "$(openssl rand -hex 24)" > .env)
   ```

2. Levantar la base, migrar y crear la primera cuenta:

   ```bash
   docker compose up -d db
   docker compose build backend
   docker compose run --rm backend python -m vigia_backend.migrate upgrade
   docker compose run --rm backend python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
   docker compose up -d backend web
   ```

Compose no arranca sin `VIGIA_DB_PASSWORD` y el backend espera a que `db` esté sano. Postgres se publica en `127.0.0.1:5432` para herramientas locales; usa `scram-sha-256`.

Para correr el backend fuera de Docker contra esa base:

```bash
DATABASE_URL="postgresql+psycopg://vigia:${VIGIA_DB_PASSWORD}@127.0.0.1:5432/vigia" uvicorn vigia_backend.api:app
```

## Respaldos y prueba de restauración

```bash
bash infra/postgres/backup.sh            # backups/postgres/vigia-AAAAMMDDTHHMMSSZ.dump (0600)
bash infra/postgres/restore-check.sh     # restaura el último en una base temporal y compara conteos
```

`backup.sh` usa `pg_dump -Fc`, nunca sobrescribe, verifica que el archivo se pueda leer y conserva los últimos 14 (`VIGIA_BACKUP_KEEP`). `backups/` está ignorado por Git. Con el Docker rootless del proyecto, anteponer `VIGIA_COMPOSE="bash infra/docker-local.sh compose"`.

No se instala ninguna tarea programada. Para el piloto se recomienda un respaldo diario y una prueba de restauración semanal, por ejemplo con cron del usuario:

```cron
30 2 * * *  cd ~/py_vigia && bash infra/postgres/backup.sh >> backups/backup.log 2>&1
0 3 * * 0   cd ~/py_vigia && bash infra/postgres/restore-check.sh >> backups/backup.log 2>&1
```

Copiar los respaldos fuera del equipo (disco externo o almacenamiento institucional) queda a cargo del equipo; un respaldo en el mismo disco no protege ante su pérdida.

## Cambios de código asociados

- Driver `psycopg` 3 y pool con `pool_pre_ping` para sobrevivir a reinicios de la base.
- **Reintentos concurrentes de ingestión.** En Postgres dos reintentos del mismo evento pueden pasar la verificación a la vez; el segundo queda esperando en el índice único y recibe `IntegrityError`. Antes eso era un error 500; ahora la petición se revierte y se reevalúa, respondiendo `duplicate`. Lo cubre `tests/test_postgres.py`, que falla sin la corrección.
- Las fechas vuelven con zona horaria (`TIMESTAMPTZ`); el código ya normalizaba las fechas sin zona de SQLite.

## Pruebas contra Postgres

```bash
docker compose exec db psql -U vigia -d vigia -c "CREATE DATABASE vigia_test"   # una vez
VIGIA_TEST_POSTGRES_URL="postgresql+psycopg://vigia:${VIGIA_DB_PASSWORD}@127.0.0.1:5432/vigia_test" \
  python -m pytest tests/test_postgres.py -v
```

Cubre migraciones de ida y vuelta contra los modelos, fechas en UTC, reintentos concurrentes y el flujo de sesión, consulta y exportación. Borra y recrea el esquema de esa base: nunca apuntarla a `vigia`.

## Datos anteriores

Las bases SQLite de `apps/backend/data/` eran de prueba (seed y validaciones). No se migraron. `validation.db` conserva los 480 eventos de la prueba con la cámara real del 28/09/2026 como evidencia para el informe.
