# Credenciales individuales de nodos — primer incremento P0.4

La ingestión exige por defecto `INGEST_AUTH_MODE=device`. Sin token, con token revocado o vencido devuelve 401. Un token válido de otra cámara devuelve 403. No hay fallback al token común aunque `INGEST_API_TOKEN` siga definido en un `.env` anterior.

Cada secreto contiene 256 bits aleatorios. La base almacena únicamente su hash SHA-256, la cámara, vigencia y revocación. SHA-256 se usa para estos tokens de alta entropía; no es el esquema propuesto para futuras contraseñas de personas.

## Emisión local

Desde `apps/backend`, con el entorno virtual activo y `DATABASE_URL` apuntando a la misma base que utiliza el servicio:

```bash
python -m vigia_backend.device_credentials issue --camera CAM-01 --days 90 --output .env.cam01-token
python -m vigia_backend.device_credentials list
```

La cámara debe estar registrada. El comando crea un archivo nuevo 0600 con `VIGIA_CENTRAL_API_TOKEN=...`, nunca imprime el token ni sobrescribe archivos existentes. Imprime el identificador de credencial y vencimiento. Transfiere ese archivo al edge por un canal administrativo seguro e incorpora la variable en su `.env`; no la pegues en tickets, Git o capturas.

En el backend:

```dotenv
INGEST_AUTH_MODE=device
```

En el edge:

```dotenv
VIGIA_CAMERA_ID=CAM-01
VIGIA_CENTRAL_API_URL=http://10.77.0.1:8443
VIGIA_CENTRAL_API_TOKEN=VALOR_DEL_ARCHIVO_EMITIDO
```

Para pruebas en la misma máquina utiliza `http://127.0.0.1:8000`. Reinicia visión tras cambiar variables.

Con Compose, ejecutar el comando dentro del backend para que use su volumen:

```bash
docker compose exec backend python -m vigia_backend.device_credentials issue \
  --camera CAM-01 --days 90 --output /app/data/.env.cam01-token
docker compose cp backend:/app/data/.env.cam01-token apps/vision/.env.cam01-token
chmod 600 apps/vision/.env.cam01-token
```

Incorpora la variable en `apps/vision/.env` y recrea visión. El archivo entregado sigue siendo un secreto; conserva solo las copias operativas necesarias.

## Rotación y revocación

1. Emitir un token nuevo para la misma cámara y guardarlo en otro archivo.
2. Instalarlo en el edge, reiniciar visión y verificar `publisher.lastDeliveredAt` y cola en cero.
3. Revocar el anterior mediante su UUID:

```bash
python -m vigia_backend.device_credentials revoke --id UUID_DE_CREDENCIAL
python -m vigia_backend.device_credentials audit
```

Se permite un período de solapamiento para no perder publicaciones durante la rotación. La revocación afecta también reintentos de eventos ya recibidos. No requiere reiniciar el backend.

La auditoría registra emisión, revocación y rechazo, sin secretos ni payloads. La CLI muestra los últimos 100 registros. La retención y límites ante abuso de intentos se completarán con la auditoría general; restringir el acceso de red mientras tanto.

## Migrar el MVP anterior

Hacer copia de la base antes del cambio. Las nuevas tablas son aditivas y se crean con el mecanismo `create_all` vigente; aún faltan migraciones versionadas Alembic. Emitir credenciales para los nodos registrados y desplegarlas antes de reiniciar el backend en modo `device`.

Solo si hace falta una transición controlada, `INGEST_AUTH_MODE=legacy` conserva el token común no vacío. No admite ingestión anónima y no cumple aislamiento por cámara. Retirar ese modo al terminar la migración. La instalación nueva nunca necesita `legacy`.

El seed borra/recrea dispositivos: sus credenciales se invalidan por cascada. Úsalo antes de emitir tokens y exclusivamente en una base de prueba.

## Alcance de seguridad pendiente

Esta entrega protege la ingestión y avanza P0.4, pero no completa autenticación de operadores ni la auditoría general. CRUD, consultas, etiquetado y preview aún requieren sesiones/roles; no publicar esos puertos en Internet. El proxy WireGuard solo permite ingestión/salud y Compose los enlaza a loopback. La administración de credenciales exige acceso local al servidor; no se añade un endpoint de emisión accesible sin autenticación.
