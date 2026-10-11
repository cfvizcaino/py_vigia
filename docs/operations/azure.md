# Servidor central en Azure (piloto)

Desde el 10/10/2026 el centro del piloto corre en Azure for Students. Edges, app móvil y consola se conectan a él; ya no hace falta correr un backend por persona.

**URL:** <https://vigia-5dfe.mexicocentral.cloudapp.azure.com>

| Ruta | Destino |
|---|---|
| `/` | Consola web (inicio de sesión) |
| `/api/v1/*` | API: app móvil y edges (ingestión con token de dispositivo) |
| `/health` | Salud del backend |

## Infraestructura

| Elemento | Valor |
|---|---|
| Suscripción | Azure for Students |
| Región | México Central. La política de la suscripción solo permite México Central, Brazil South, Canada Central y West US 3; se eligió la más cercana a Barranquilla, que además deja los datos en Latinoamérica. |
| Grupo de recursos | `vigia-rg` |
| Máquina | `vigia-central`, Standard_B2ats_v2 (2 vCPU AMD, 1 GB RAM + 2 GB swap), Ubuntu 24.04 LTS, SSD estándar de 30 GB |
| Costo | La VM entra en las 750 h/mes gratuitas del plan de estudiante; la IP pública estática y el disco se pagan con el crédito (unos 6 USD al mes, a confirmar en *Cost Management*). |
| Firewall (NSG) | 80 y 443 abiertos; 22 solo desde la IP del administrador. Postgres, OSRM, backend y consola no se exponen. |
| HTTPS | Caddy con certificado automático de Let's Encrypt (renovación automática) |
| SSH | Usuario `vigia`, solo llave (`~/.ssh/vigia_azure`); contraseñas desactivadas |

El servidor no compila: las imágenes se construyen en el PC y se suben. YOLO no corre en la nube; la detección sigue en los edges y al servidor solo llegan metadatos.

## Desplegar o actualizar

Desde la raíz del repositorio, con el Docker local del proyecto:

```bash
export VIGIA_COMPOSE="bash infra/docker-local.sh compose"
H=vigia-5dfe.mexicocentral.cloudapp.azure.com
bash infra/docker-local.sh compose build backend web     # compilar en el PC
bash infra/azure/deploy.sh $H push                        # subir imágenes
bash infra/azure/deploy.sh $H sync                        # compose, Caddyfile, OSRM, respaldos
bash infra/azure/deploy.sh $H up                          # migrar y reiniciar
bash infra/azure/deploy.sh $H status
```

La primera vez, `bootstrap` instala Docker y swap. `up` crea el `.env` del servidor con una contraseña de base generada allá mismo, que no sale de la máquina.

## Edges

Los nodos de visión publican con `VIGIA_CENTRAL_API_URL=https://vigia-5dfe.mexicocentral.cloudapp.azure.com` y su token de dispositivo. Para dar de alta uno nuevo: **App → Cámaras → Agregar edge** y luego, en el PC del nodo:

```bash
bash infra/edges/install-node-token.sh CEL-02 8082 https://vigia-5dfe.mexicocentral.cloudapp.azure.com
```

## App móvil

En la app: ícono de enlace → `https://vigia-5dfe.mexicocentral.cloudapp.azure.com` → **Guardar**. Funciona con datos móviles o cualquier Wi-Fi, sin cable ni `adb reverse`.

## Respaldos

Cron del usuario `vigia` en el servidor:

- 02:30 (hora de Colombia), diario: `pg_dump` a `/opt/vigia/backups`, 14 copias.
- Domingos: prueba de restauración en una base temporal.
- Registro en `/opt/vigia/backups/backup.log`.

Los respaldos están en el mismo disco de la VM: copiarlos periódicamente fuera de Azure.

## Si cambia tu IP (SSH bloqueado)

```bash
az network nsg rule update -g vigia-rg --nsg-name vigia-centralNSG -n ssh-solo-admin --source-address-prefixes "$(curl -s https://api.ipify.org)/32"
```

## Pendiente

- Aprobación de los tutores sobre el alojamiento de datos fuera de Colombia (Ley 1581).
- Límite de peticiones por IP en Caddy; hoy existe el bloqueo por cuenta del login.
- Optimizar la imagen web (1,15 GB por dependencias de desarrollo): usar la salida *standalone* de Next.js.
- Si crece el uso, cambiar el tamaño de la VM (por ejemplo, B2als v2 con 4 GB) sin perder el disco.
