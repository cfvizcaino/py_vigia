# P0.4: migraciones versionadas y adopción del MVP

Alembic sustituye `create_all` en el arranque. El API, seed y CLI de credenciales verifican que la base esté en la revisión vigente y fallan con un mensaje accionable si no lo está. No modifican silenciosamente una base existente. Las pruebas unitarias pueden seguir creando sus bases efímeras desde los modelos.

- `0001`: snapshot congelado del esquema MVP, incluidas credenciales y auditoría.
- `0002`: alternativas viales, fuente y fecha de sincronización. Las distancias antiguas no se convierten falsamente en datos OSRM.

## Base nueva

Desde `apps/backend`, con el entorno activo y `DATABASE_URL` apuntando a la base correcta:

```bash
uv pip install -r requirements.txt
python -m vigia_backend.migrate upgrade
python -m vigia_backend.migrate check
# Solo para una base de prueba nueva:
python -m vigia_backend.seed
```

## Base existente sin versión

Detener API y otros escritores durante adopción. No ejecutar seed. El siguiente comando compara el esquema contra la revisión congelada, rechaza cambios desconocidos, crea un respaldo SQLite consistente en un archivo nuevo 0600, incorpora las tablas de credenciales/auditoría si faltan y aplica las revisiones pendientes:

```bash
python -m vigia_backend.migrate adopt-legacy --backup data/respaldo-pre-alembic.db
python -m vigia_backend.migrate check
```

No usar `alembic stamp head` directamente. Un backup ya existente no se sobrescribe; elegir otro nombre. La adopción automática soporta SQLite; otros motores requieren un procedimiento revisado. Mantener los respaldos fuera de Git y en almacenamiento protegido.

## Compose

```bash
docker compose build backend
# Base nueva o ya versionada:
docker compose run --rm backend python -m vigia_backend.migrate upgrade
# Alternativa para MVP existente, con backend detenido:
# docker compose run --rm backend python -m vigia_backend.migrate adopt-legacy --backup /app/data/respaldo-pre-alembic.db
docker compose up -d backend
```

Las revisiones se copian dentro de la imagen. No se ejecutan migraciones destructivas automáticamente al arrancar contenedores ni múltiples workers.

## Validación y recuperación

Se prueban: base nueva/idempotencia, igualdad con modelos, preservación de usuarios y respaldo, MVP anterior a credenciales, rechazo de esquema desconocido y rechazo de sobrescritura del respaldo. También downgrade/upgrade de `0002` sobre una base desechable.

Para recuperar datos operativos, detener escritores, preservar la base fallida y restaurar el respaldo junto con la versión del código correspondiente. No ejecutar downgrade sobre producción sin revisar pérdidas: bajar `0002` elimina las alternativas viales almacenadas; bajar `0001` elimina tablas. La prueba de downgrade no autoriza hacerlo sobre datos reales.

P0.4 sigue parcial: faltan usuarios autenticados, roles aplicados a CRUD/preview y auditoría de uso. El usuario demo aún no es una identidad autenticada. Mantener servicios en loopback/VPN restringida.
