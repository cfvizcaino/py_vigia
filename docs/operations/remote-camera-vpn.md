# VPN autogestionada, sin licencias por cámara

Decisión del 30 de septiembre de 2026: WireGuard directo como primera opción, condicionado a un servidor central alcanzable por UDP. La accesibilidad del servidor todavía no está confirmada; esta guía y el generador están preparados, pero no se ha activado una VPN real.

## Qué significa gratuita y escalable

Los vecinos no pagan una suscripción VPN. WireGuard no introduce cuotas comerciales por cámara o usuario. El proyecto sí necesita equipos, electricidad, conectividad y administración; reutilizar recursos existentes o institucionales puede evitar un nuevo gasto, pero no permite prometer capacidad infinita ni operación sin costo.

| Alternativa | Sin suscripción VPN | Operación y límites | Uso en VIGIA |
|---|---|---|---|
| WireGuard directo | Sí, software libre | Requiere un concentrador alcanzable por UDP; claves y firewall a cargo del proyecto | Base implementada: estrella edge→centro |
| Headscale + clientes compatibles | Sí, control autogestionado | Coordinador y, para NAT difíciles, DERP propio; comprobar compatibilidad y límites de una tailnet | Alternativa si se necesita coordinación automática |
| NetBird autogestionado | Sí para sus componentes abiertos necesarios | Más servicios, control de acceso y relay propios; algunas capacidades empresariales tienen licencia | Alternativa si el panel de gestión compensa la complejidad |
| Plan gratuito de un VPN comercial | Depende de cuotas/condiciones ajenas | No es una garantía de crecimiento gratuito del proyecto | No se adopta como dependencia |

Referencias: [WireGuard](https://www.wireguard.com/), [Headscale](https://headscale.net/stable/) y [NetBird autogestionado](https://docs.netbird.io/selfhosted/selfhosted-guide). No se exige adquirir ninguno de sus servicios alojados.

## Topología y aislamiento

Cada cámara conserva RTSP/554 en su LAN. Un equipo edge junto a ella ejecuta visión, guarda la cola y establece el túnel hacia el centro:

```text
Cámara Wi-Fi ── RTSP LAN ── Edge CAM-01 ── WireGuard UDP ── Central
                                10.77.0.11               10.77.0.1
                                                        ingest :8443
                                                           │
                                                 backend 127.0.0.1:8000
```

El centro conoce una clave pública y una dirección /32 por edge. Cada edge conoce solo el /32 del centro. No se anuncian las LAN domésticas, no se cambia la ruta de Internet, no se habilita NAT ni el reenvío entre clientes.

El firewall generado descarta forwarding desde/hacia `wg-vigia`. En el centro solo admite conexiones entrantes por el túnel al proxy de ingestión TCP/8443. El proxy únicamente permite POST al endpoint de ingestión y GET de salud: un edge no puede usar los CRUD o consultar/exportar datos por ese puerto. En el edge se permiten las respuestas de conexiones iniciadas por él; el preview remoto está desactivado por defecto.

El proxy usa HTTP **dentro del túnel cifrado y enlazado exclusivamente a la IP WireGuard**. No es un endpoint HTTP público. Si se añade un salto fuera de ese host/túnel, debe protegerse con TLS. La VPN no reemplaza los roles y sesiones de la aplicación, pendientes en P0.4.

## 1. Verificar la conectividad antes de instalar

1. Revisar en el router la dirección WAN, compararla con la IP pública de esa conexión y consultar al administrador/ISP si existe CGNAT o doble NAT. Direcciones WAN privadas o 100.64.0.0/10 son indicios, no una prueba única.
2. Si hay IPv4 pública, permitir/redirigir únicamente UDP/51820 al servidor central. Una IP dinámica puede usar DNS dinámico sin cuota obligatoria; actualizar el endpoint del edge si cambia.
3. Si solo hay IPv6 pública, verificar alcance IPv6 desde todas las sedes. El generador actual acepta un nombre DNS o IPv4 como endpoint; un nombre con AAAA evita un literal IPv6.
4. Si el centro no acepta conexiones entrantes, usar un concentrador/relay en infraestructura institucional o comunitaria alcanzable. Headscale/NetBird tampoco eliminan la necesidad de un punto público para coordinar o retransmitir cuando NAT impide conexión directa.
5. La prueba definitiva es un handshake WireGuard desde otra red (por ejemplo una conexión móvil); no basta un ping ni un escáner TCP para UDP.

Hasta resolver este punto no se debe declarar P0.2 validado en campo.

## 2. Preparar claves e inventario

Instalar WireGuard tools, nftables y Python 3 en centro/edge con el gestor de paquetes del sistema; nginx solo en el centro. Ejemplo Fedora: `sudo dnf install wireguard-tools nftables nginx`; Debian/Ubuntu: `sudo apt install wireguard nftables nginx`.

En **cada host**, generar su propia clave privada con permisos restrictivos:

```bash
mkdir -p infra/wireguard/private
chmod 700 infra/wireguard/private
umask 077
wg genkey | tee infra/wireguard/private/host.key | wg pubkey
```

Ejecutar una sola vez por host; no sobrescribir una clave activa. Solo se comparte la clave pública impresa, nunca `host.key`.

Copiar `infra/wireguard/inventory.example.json` a `infra/wireguard/private/inventory.json` y completar endpoint, IP y claves públicas reales. Distribuir ese inventario por un canal administrativo confiable a los hosts participantes. Verificar que 10.77.0.0/24 no se superpone con ninguna red local; cambiarla si hace falta.

El inventario de ejemplo no es activable: el generador rechaza los marcadores sin claves reales, IP/identidades/claves duplicadas y rutas fuera del prefijo.

En el centro:

```bash
python3 infra/wireguard/render.py \
  --inventory infra/wireguard/private/inventory.json \
  --node central \
  --private-key-file infra/wireguard/private/host.key \
  --output infra/wireguard/private/central
```

En CAM-01, con la clave privada de ese host:

```bash
python3 infra/wireguard/render.py \
  --inventory infra/wireguard/private/inventory.json \
  --node CAM-01 \
  --private-key-file infra/wireguard/private/host.key \
  --output infra/wireguard/private/CAM-01
```

El generador comprueba que la clave privada produzca la pública registrada y escribe archivos 0600 en una carpeta nueva 0700. No ejecuta comandos de instalación ni modifica interfaces/firewall. Rechaza directorios existentes para evitar sobrescribir una configuración activa.

## 3. Instalar después de revisar la configuración

Ejemplo del centro, adaptando el directorio de salida en cada edge:

```bash
sudo install -m 600 infra/wireguard/private/central/wg-vigia.conf /etc/wireguard/wg-vigia.conf
sudo nft --check --file infra/wireguard/private/central/vigia-vpn.nft
sudo nft --file infra/wireguard/private/central/vigia-vpn.nft
sudo systemctl enable --now wg-quick@wg-vigia
sudo wg show wg-vigia
```

Los comandos son de primera instalación. Para actualizaciones, revisar diferencias y reemplazar atómicamente solo la tabla `inet vigia_vpn`; nunca ejecutar `flush ruleset`. Integrar las reglas con el firewall existente (incluido firewalld si está activo) y hacerlas persistentes **antes** de habilitar arranque automático del túnel. Las reglas propias pueden aceptar un paquete que otra cadena del host descarte; abrir UDP/51820 en el firewall existente y el puerto interno 8443 solo para la interfaz VPN.

En el centro, instalar el proxy dentro del contexto `http` de nginx:

```bash
sudo install -m 600 infra/wireguard/private/central/vigia-ingest.nginx.conf /etc/nginx/conf.d/vigia-ingest.conf
sudo nginx -t
sudo systemctl reload nginx
```

Si nginx aún no corre, iniciarlo después de validar su configuración. Configurar su unidad systemd para arrancar después de `wg-quick@wg-vigia.service`, porque escucha en esa IP. Deshabilitar cualquier sitio público por defecto si no se usa. Backend debe escuchar en loopback: Compose ya publica 8000/8001/3000/5000 solo en 127.0.0.1.

## 4. Credencial de aplicación por cámara

Emitirla mediante [la guía de credenciales](./device-credentials.md). En el edge:

```dotenv
VIGIA_CAMERA_ID=CAM-01
VIGIA_CENTRAL_API_URL=http://10.77.0.1:8443
VIGIA_CENTRAL_API_TOKEN=SECRETO_INDIVIDUAL_EMITIDO
```

El token de CAM-01 solo acepta eventos con `cameraId=CAM-01`. La clave WireGuard y el token HTTP son secretos distintos y se revocan por separado.

## 5. Validación real

Desde cada edge:

```bash
sudo wg show wg-vigia latest-handshakes
curl --max-time 5 -fsS http://10.77.0.1:8443/health
curl --max-time 5 -i http://10.77.0.1:8443/api/v1/devices
curl -fsS http://127.0.0.1:8001/api/v1/status
```

Esperado: handshake reciente, salud 200, CRUD 404, visión en ejecución y cola tendiendo a cero. Un intento de conexión edge→edge y edge→puertos 8000/22 del centro debe fallar. No se usa ping como aceptación porque ICMP entrante está bloqueado en la política mínima.

Cortar Internet del edge durante cinco minutos dejando cámara y LAN activas. La cola debe crecer; al restaurar, debe vaciarse sin duplicados. Registrar eventos pendientes, duración, último acuse y versión. Si se revoca una credencial, se espera 401; identidad ajena, 403. No eliminar la cola para esconder un fallo.

## Revocación, recuperación y escala

Para retirar una sede, revocar su token y quitar su clave pública del centro (`sudo wg set wg-vigia peer CLAVE_PUBLICA remove`), además de retirar el peer del inventario/configuración persistente. Conservar evidencia de la operación. No basta borrar el archivo local si el peer sigue cargado.

Para rollback local del túnel: `sudo systemctl disable --now wg-quick@wg-vigia`; conservar las claves y configuración para diagnóstico. No borrar las reglas de otros servicios. Realizar cambios de firewall desde consola local o una vía de administración independiente.

La estrella almacena O(N) peers en el centro y O(1) en cada edge. Una /24 deja un máximo de 253 direcciones para edges si el centro ocupa una; ampliar prefijo o dividir por barrios al acercarse a ese límite. Eso es capacidad de direccionamiento, no throughput garantizado. El centro y SQLite aún son puntos únicos de fallo: medir 4/10/25 nodos, CPU, ancho de banda y latencia; después particionar concentradores y evolucionar persistencia según P1. No habilitar video permanente hacia el centro.

La política Tailscale antigua se retira como receta activa. No se crean cuentas comerciales ni se contratan servicios para esta solución.
