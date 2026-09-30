"""Renderiza configuración revisable; no instala ni modifica la red del host.

El inventario contiene SOLO claves públicas. Cada clave privada se lee en el
host propietario y se comprueba contra el inventario con `wg pubkey`.
"""
from __future__ import annotations

import argparse
import base64
import ipaddress
import json
import os
from pathlib import Path
import re
import subprocess


def validate_inventory(value: dict) -> dict:
    network = ipaddress.IPv4Network(value["network"])
    private_ranges = [ipaddress.IPv4Network(prefix) for prefix in ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16")]
    if not any(network.subnet_of(prefix) for prefix in private_ranges) or network.prefixlen < 16:
        raise ValueError("Usa una red privada IPv4 /16 o más pequeña sin solapamientos con las LAN.")
    central = value["central"]
    endpoint = central["endpoint"]
    if not re.fullmatch(r"[a-zA-Z0-9.-]+:[0-9]{1,5}", endpoint):
        raise ValueError("Endpoint esperado: DNS-o-IPv4:puerto; no se admiten instrucciones ni saltos de línea.")
    if not 1 <= int(endpoint.rsplit(":", 1)[1]) <= 65535:
        raise ValueError("Puerto UDP inválido.")
    if central["id"] != "central" or not value["nodes"]:
        raise ValueError("Se requieren central y al menos un nodo.")
    ids, addresses, keys = set(), set(), set()
    for peer in [central, *value["nodes"]]:
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", peer["id"]):
            raise ValueError("Identificador de nodo inválido.")
        address = ipaddress.IPv4Address(peer["address"])
        if address not in network or address in (network.network_address, network.broadcast_address):
            raise ValueError("Dirección de nodo fuera de la red o reservada.")
        key = base64.b64decode(peer["public_key"], validate=True)
        if len(key) != 32 or key == bytes(32):
            raise ValueError("Clave pública WireGuard inválida.")
        for seen, item in ((ids, peer["id"]), (addresses, str(address)), (keys, key)):
            if item in seen:
                raise ValueError("Identificador, IP o clave duplicada en el inventario.")
            seen.add(item)
    return value


def render(value: dict, node_id: str, private_key: str) -> dict[str, str]:
    validate_inventory(value)
    central = value["central"]
    peers = {peer["id"]: peer for peer in [central, *value["nodes"]]}
    if node_id not in peers:
        raise ValueError("Nodo no registrado en el inventario.")
    if len(base64.b64decode(private_key, validate=True)) != 32 or "\n" in private_key:
        raise ValueError("Clave privada inválida.")
    peer = peers[node_id]
    is_central = node_id == "central"
    config = ["[Interface]", f"Address = {peer['address']}/32", f"PrivateKey = {private_key}"]
    if is_central:
        config.append(f"ListenPort = {central['endpoint'].rsplit(':', 1)[1]}")
    for remote in value["nodes"] if is_central else [central]:
        config.extend(["", f"# {remote['id']}", "[Peer]", f"PublicKey = {remote['public_key']}", f"AllowedIPs = {remote['address']}/32"])
        if not is_central:
            config.extend([f"Endpoint = {central['endpoint']}", "PersistentKeepalive = 25"])
    # These rules cover only wg-vigia; they never flush the host firewall.
    allowed = "\n".join(
        f'    iifname "wg-vigia" ip saddr {node["address"]} ip daddr {central["address"]} tcp dport 8443 accept'
        for node in value["nodes"]
    ) if is_central else ""
    firewall = f'''table inet vigia_vpn {{
  chain input {{
    type filter hook input priority -10; policy accept;
    iifname "wg-vigia" ct state established,related accept
{allowed}
    iifname "wg-vigia" drop
  }}
  chain forward {{
    type filter hook forward priority -10; policy accept;
    iifname "wg-vigia" drop
    oifname "wg-vigia" drop
  }}
}}
'''
    result = {"wg-vigia.conf": "\n".join(config) + "\n", "vigia-vpn.nft": firewall}
    if is_central:
        result["vigia-ingest.nginx.conf"] = f'''# Incluir dentro del contexto http de nginx, después de levantar wg-vigia.
server {{
    listen {central['address']}:8443;
    server_name _;
    client_max_body_size 2m;
    # HTTP va exclusivamente dentro del túnel WireGuard cifrado.
    location = /api/v1/ingest/detections {{
        limit_except POST {{ deny all; }}
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header X-Vigia-Device-Token $http_x_vigia_device_token;
    }}
    location = /health {{
        limit_except GET {{ deny all; }}
        proxy_pass http://127.0.0.1:8000;
    }}
    location / {{ return 404; }}
}}
'''
    return result


def write_bundle(output: Path, files: dict[str, str]) -> None:
    # A new directory avoids overwriting keys/configuration, including symlinks.
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, content in files.items():
        descriptor = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as target:
            target.write(content)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--node", required=True)
    parser.add_argument("--private-key-file", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        inventory = validate_inventory(json.loads(args.inventory.read_text()))
        if args.private_key_file.stat().st_mode & 0o077:
            raise ValueError("La clave privada debe tener permisos 0600.")
        private_key = args.private_key_file.read_text().strip()
        files = render(inventory, args.node, private_key)
        actual_public = subprocess.run(["wg", "pubkey"], input=private_key + "\n", text=True, capture_output=True, check=True).stdout.strip()
        peer = next(p for p in [inventory["central"], *inventory["nodes"]] if p["id"] == args.node)
        if actual_public != peer["public_key"]:
            raise ValueError("La clave privada no corresponde a la clave pública registrada.")
        write_bundle(args.output, files)
    except (ValueError, KeyError, TypeError, OSError, subprocess.CalledProcessError):
        parser.exit(1, "No se generó el paquete completo: revisa inventario, permisos 0600, claves, wg instalado y directorio de salida nuevo.\n")
    print(f"Paquete creado en {args.output}. No se ha activado la VPN.")


if __name__ == "__main__":
    main()
