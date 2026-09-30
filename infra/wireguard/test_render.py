import base64
import copy
from pathlib import Path
import tempfile
import unittest

from render import render, validate_inventory, write_bundle


def key(number):
    return base64.b64encode(bytes([number]) * 32).decode()


class WireGuardTests(unittest.TestCase):
    def setUp(self):
        self.inventory = {"network": "10.77.0.0/24", "central": {"id": "central", "address": "10.77.0.1", "endpoint": "vpn.example.org:51820", "public_key": key(1)},
                          "nodes": [{"id": "CAM-01", "address": "10.77.0.11", "public_key": key(2)}, {"id": "CAM-02", "address": "10.77.0.12", "public_key": key(3)}]}

    def test_central_has_only_individual_routes_and_ingest_port(self):
        files = render(self.inventory, "central", key(4))
        self.assertIn("AllowedIPs = 10.77.0.11/32", files["wg-vigia.conf"])
        self.assertNotIn("0.0.0.0/0", files["wg-vigia.conf"])
        self.assertIn('iifname "wg-vigia" drop', files["vigia-vpn.nft"])
        self.assertIn('oifname "wg-vigia" drop', files["vigia-vpn.nft"])
        self.assertIn("tcp dport 8443 accept", files["vigia-vpn.nft"])
        self.assertNotIn("flush ruleset", files["vigia-vpn.nft"])
        self.assertIn("location / { return 404; }", files["vigia-ingest.nginx.conf"])

    def test_edge_has_no_peer_to_peer_route_or_incoming_preview(self):
        files = render(self.inventory, "CAM-01", key(4))
        self.assertIn("AllowedIPs = 10.77.0.1/32", files["wg-vigia.conf"])
        self.assertIn("PersistentKeepalive = 25", files["wg-vigia.conf"])
        self.assertNotIn("10.77.0.12", files["wg-vigia.conf"])
        self.assertNotIn("dport", files["vigia-vpn.nft"])
        self.assertNotIn("vigia-ingest.nginx.conf", files)

    def test_duplicate_identity_address_and_key_are_rejected(self):
        for field in ("id", "address", "public_key"):
            inventory = copy.deepcopy(self.inventory)
            inventory["nodes"][1][field] = inventory["nodes"][0][field]
            with self.assertRaises(ValueError):
                validate_inventory(inventory)

    def test_invalid_addresses_and_configuration_injection_are_rejected(self):
        for field, value in (("address", "10.88.0.1"), ("address", "10.77.0.255"), ("id", "../../evil"), ("public_key", "placeholder")):
            inventory = copy.deepcopy(self.inventory)
            inventory["nodes"][0][field] = value
            with self.assertRaises(ValueError):
                validate_inventory(inventory)
        self.inventory["central"]["endpoint"] = "vpn:51820\nPostUp = bad"
        with self.assertRaises(ValueError):
            validate_inventory(self.inventory)

    def test_private_files_and_no_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "CAM-01"
            write_bundle(output, render(self.inventory, "CAM-01", key(4)))
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            self.assertEqual((output / "wg-vigia.conf").stat().st_mode & 0o777, 0o600)
            with self.assertRaises(FileExistsError):
                write_bundle(output, {"wg-vigia.conf": "overwrite"})


if __name__ == "__main__":
    unittest.main()
