# Sesión local P0.4 / rutas — 30 de septiembre de 2026

Entorno de validación, no exposición pública. No se modificó la base operativa `vigia.db` ni se ejecutó seed sobre ella.

## Servicios

- Web de producción local: `http://127.0.0.1:3000`.
- Backend: `http://127.0.0.1:8000`, usando **data/p04-validation-20260930.db** en `apps/backend`.
- OSRM v6.0.0: `http://127.0.0.1:5000`, contenedor `py_vigia-osrm-1` con Docker rootless.
- Visión/cámara real no forma parte de esta sesión. Las observaciones son sintéticas; las calles y alternativas OSRM son reales.

La base separada contiene el seed, migraciones `0001`/`0002`, doce pares dirigidos y diecinueve opciones OSRM. Está ignorada por Git y tiene permisos 0600. No volver a ejecutar seed salvo que se quiera reiniciar esta prueba; después habría que resincronizar enlaces.

## Probar

1. Abrir la web y confirmar **Servicio central conectado**.
2. Pulsar **Cargar escenario de prueba**, conservar automóvil/blanco y buscar.
3. Abrir **¿Por qué aparece esta ruta?**. Ver pesos 35/40/15/10, tiempos observados/referencia, alternativa y penalizaciones.
4. Seleccionar otra candidata. El mapa debe indicar **alternativa evaluada**; exportar JSON incluye `explanation` y `road_geometry`.
5. No interpretar 97/100 como 97% de probabilidad. La evidencia es incompleta y los pesos aún no están calibrados.

Prueba independiente del servicio cartográfico, desde la raíz:

```bash
python3 infra/osrm/smoke.py
bash infra/docker-local.sh compose ps osrm
ss -ltn '( sport = :5000 )'
```

Esperado: `status: passed`, cuatro cámaras a menos de 100 m de una calle, doce pares con ruta, matriz 4×4 y escucha `127.0.0.1:5000`.

## Reiniciar después de cerrar procesos o reiniciar el equipo

Desde la raíz, una terminal para cada proceso:

```bash
# Solo si el daemon local de esta prueba no está ejecutándose:
bash infra/docker-rootless.sh
```

```bash
bash infra/docker-local.sh compose --profile routing up -d osrm
cd apps/backend
DATABASE_URL=sqlite:///./data/p04-validation-20260930.db .venv/bin/python -m vigia_backend.migrate check
DATABASE_URL=sqlite:///./data/p04-validation-20260930.db .venv/bin/uvicorn vigia_backend.api:app --host 127.0.0.1 --port 8000
```

```bash
cd apps/web
npm run build
BACKEND_API_URL=http://127.0.0.1:8000 ROAD_ROUTER_URL=http://127.0.0.1:5000 npm run start -- --hostname 127.0.0.1 --port 3000
```

No se instalaron servicios de arranque automático. Los binarios locales de Docker/Compose/slirp4netns no van al repositorio; en otra máquina seguir la instalación oficial y usar `docker` habitual. Los scripts `docker-local.sh` y `docker-rootless.sh` son conveniencias para esta instalación de usuario.

## Evidencia y pendientes

- Backend: 41 pruebas (incluyen migraciones con preservación de datos, explicación persistida y una ruta de 900 m que supera a la de 600 m).
- Web: 9 unitarias, 10 E2E de escritorio/móvil, lint y build.
- OSRM: procesamiento MLD y pruebas HTTP reales; ver [detalle y checksum](./osrm-self-hosted.md).
- P0.4: credenciales y migraciones implementadas. Login, sesiones, roles y auditoría de operadores siguen pendientes; CRUD/preview no deben exponerse públicamente.
- Este extracto pequeño no demuestra cobertura de toda la ciudad ni precisión del correlador con vehículos reales.
