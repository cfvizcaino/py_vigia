# Acceso de personas: usuarios, roles y auditoría de uso

Tercer corte de P0.4. Las personas inician sesión con correo y contraseña; el backend aplica los roles y registra quién consultó, exportó, abrió el video o cambió datos. Los nodos edge siguen usando sus [credenciales de dispositivo](./device-credentials.md), que son independientes.

## Modelo

| Elemento | Decisión |
|---|---|
| Contraseña | `scrypt` de la biblioteca estándar (N=2¹⁵, r=8, p=1, sal de 16 bytes). Parámetros guardados en el hash para endurecerlos después sin migrar. Longitud 12–256. |
| Sesión | Token portador aleatorio de 256 bits. En base solo se guarda su SHA-256 (`user_sessions`). Vigencia `USER_SESSION_HOURS` (1–24, por defecto 8). Revocable por cierre de sesión, cambio de contraseña o deshabilitación. |
| Bloqueo | 5 intentos fallidos en 15 minutos bloquean la cuenta durante esa ventana (HTTP 429), aunque luego llegue la contraseña correcta. Correo inexistente y contraseña incorrecta responden igual. |
| Web | El token vive en la cookie `vigia_session` (`HttpOnly`, `SameSite=Strict`, `Secure` bajo HTTPS o con `SESSION_COOKIE_SECURE=true`). El JavaScript del navegador nunca lo lee. |
| Altas | Solo por CLI con acceso al host/base. No hay registro público ni alta HTTP. |

## Permisos aplicados en el backend

| Acción | Anónimo | `operator` | `admin` |
|---|:-:|:-:|:-:|
| `GET /health`, ingestión con token de dispositivo | ✓ | ✓ | ✓ |
| Ver dispositivos y detecciones | 401 | ✓ | ✓ |
| Ejecutar consultas de trayectorias | 401 | ✓ (auditada) | ✓ (auditada) |
| Exportar una consulta | 401 | solo las propias (auditada) | cualquiera (auditada) |
| Abrir preview/stream de cámara | 401 | ✓ (auditada) | ✓ (auditada) |
| Crear/editar/borrar dispositivos o detecciones | 401 | 403 (auditada) | ✓ (auditada) |
| Emitir/revocar credenciales de nodos por HTTP | 401 | 403 | ✓ (auditada) |
| Leer la auditoría `GET /api/v1/admin/audit` | 401 | 403 | ✓ |
| Etiquetado de placas (web) | 401 | 403 | ✓ |

La interfaz solo oculta o muestra; la decisión está en `vigia_backend/auth.py`. Exportar una consulta ajena responde 404 para no revelar que existe.

## Qué se audita (`security_audit`)

`auth.login` (allowed/invalid/locked), `auth.logout`, `query.executed`, `query.exported`, `preview.accessed`, `device.*`, `detection.*`, `credential.issued/revoked`, `user.*` (CLI) y `authz.denied`. Cada fila guarda la persona, el resultado y un detalle mínimo (id de consulta, cámara, campos cambiados). No guarda contraseñas, tokens, imágenes ni coordenadas; estas siguen en `queries`.

Los rechazos anónimos (401) no se guardan: permitirían a cualquiera llenar la tabla. Se cubren con límites de red/proxy.

## Puesta en marcha

Requiere la revisión Alembic `0003` (agrega `password_hash`, `is_active`, `user_sessions` y columnas de auditoría). Los usuarios existentes, como el operador del seed, quedan activos **sin** contraseña: no pueden entrar hasta asignarles una.

```bash
cd apps/backend
python -m vigia_backend.migrate upgrade
python -m vigia_backend.users create --email admin@ejemplo.org --name "Administración" --role admin
python -m vigia_backend.users create --email operador@ejemplo.org --name "Operador turno 1"
python -m vigia_backend.users list
```

La contraseña se pide dos veces por terminal. Para automatizar, `--password-stdin` lee una línea de stdin; nunca se pasa como argumento porque quedaría en el historial.

Con Compose:

```bash
docker compose run --rm backend python -m vigia_backend.migrate upgrade
docker compose run --rm backend python -m vigia_backend.users create --email admin@ejemplo.org --name Admin --role admin
```

Otras operaciones: `set-password --email …` y `disable --email …` revocan todas las sesiones abiertas; `enable --email …` reactiva la cuenta.

## API

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/v1/auth/login` | `{email, password}` → `{token, expires_at, user}` (token mostrado una vez) |
| POST | `/api/v1/auth/logout` | Revoca la sesión actual |
| GET | `/api/v1/auth/me` | Persona y vencimiento de la sesión |
| POST | `/api/v1/auth/preview-access` | La web lo llama antes de abrir el video; autoriza y audita |
| POST | `/api/v1/queries/{id}/export` | Exportación generada en servidor desde lo persistido |
| GET | `/api/v1/admin/audit?action=&limit=` | Solo admin |
| GET | `/api/v1/admin/credentials` | Solo admin; nunca devuelve secretos |
| POST | `/api/v1/admin/devices/{CAM}/credentials` | Solo admin; `{days}` → secreto una sola vez |
| DELETE | `/api/v1/admin/credentials/{id}` | Solo admin |

Todas las rutas protegidas esperan `Authorization: Bearer <token>`. Un cliente móvil usa el mismo flujo.

## Validación realizada (08/10/2026)

- 62 pruebas backend, 10 unitarias web y 14 Playwright (escritorio y móvil) en verde.
- Flujo real sin simulaciones, primero con servidores locales y después con Docker Compose (`backend`, `web`, `osrm`) en un proyecto aislado: anónimo recibe 401 en dispositivos, consultas, stream, geometría y etiquetado; el operador consulta (3 rutas, geometría `road-network` desde OSRM), exporta y recibe 403 al cambiar un dispositivo o leer la auditoría; el administrador emite una credencial; la auditoría registra cada paso con su autor. Puertos efectivos solo en `127.0.0.1`.

## Límites conocidos

- Sin MFA ni OIDC. El diseño admite añadir un proveedor sin cambiar los roles.
- El bloqueo es por cuenta; no limita por IP. Exponer la consola fuera de la VPN exige además TLS y límite de velocidad en el proxy.
- No hay alta/edición de personas por HTTP ni pantalla de auditoría en la web; se usa la CLI y `GET /api/v1/admin/audit`.
- El veto de etiquetado de placas para operadores se decide en la web (consultando el rol al backend) y no queda en la auditoría.
