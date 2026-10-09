# movil
# VIGÍA móvil

Consola móvil del operador para consultar cámaras y trayectorias estimadas del backend FastAPI. **Explorar demo** usa datos locales de ejemplo, siempre se identifica como demostración y nunca se activa como fallback de una conexión fallida.

## Configurar el backend

La URL base se configura desde el icono de enlace en login o en **Ajustes**. Por defecto es `http://10.0.2.2:8000`, dirección del host vista desde el emulador Android. La URL se guarda en preferencias locales; el token se conserva únicamente con `flutter_secure_storage`.

HTTP solo se acepta en `localhost`, `127.0.0.1`, `::1`, `10.0.2.2` y `10.0.3.2`. Para equipos físicos u otros hosts configura HTTPS. Android deniega tráfico claro por defecto y permite excepciones solo para esos hosts. En iOS, ATS permite HTTP únicamente para `localhost`.

## Crear un usuario

Desde la raíz del repositorio, prepara/migra la base y crea el usuario desde `apps/backend`:

```powershell
cd apps/backend
python -m vigia_backend.migrate upgrade
python -m vigia_backend.users create --email operador@ejemplo.org --name "Operador de turno" --role operator
uvicorn vigia_backend.api:app --host 0.0.0.0 --port 8000
```

La CLI solicita la contraseña de forma interactiva. No la pases como argumento.

## Ejecutar

Desde `apps/movil`:

```bash
flutter pub get
flutter run
```

Para elegir destino explícitamente, consulta `flutter devices` y luego ejecuta `flutter run -d <id>`. En el emulador Android usa `http://10.0.2.2:8000`; en iOS Simulator, `http://localhost:8000`. En un dispositivo físico configura una URL HTTPS accesible desde la red.

## Verificar

```bash
flutter analyze
flutter test
```

La aplicación usa `/api/v1/auth/login`, `/api/v1/auth/me`, `/api/v1/auth/logout`, `/api/v1/devices`, `/api/v1/queries` y `POST /api/v1/queries/{id}/export`. Un 401 elimina el token y devuelve al login; un 403 muestra un mensaje de permisos y un 429 indica esperar 15 minutos. Los tiempos se envían como ISO-8601 UTC y se muestran en hora de Colombia. La exportación solo se comparte después de solicitar el JSON auditado al backend.
