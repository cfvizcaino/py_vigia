"""Prueba HTTP real del extracto Barranquilla: nearest, route y table.

Ejecutar contra el OSRM local levantado, nunca contra la demo pública.
"""
import argparse
import json
from urllib.request import urlopen

POINTS = [(-74.8172, 11.0131), (-74.8148, 11.0110), (-74.8069, 11.0050), (-74.8040, 11.0015)]

def check(base):
    def get(path):
        with urlopen(base.rstrip("/") + path, timeout=10) as response:
            body = json.load(response)
        assert body["code"] == "Ok", body
        return body
    snapped = []
    for lng, lat in POINTS:
        waypoint = get(f"/nearest/v1/driving/{lng},{lat}?number=1")["waypoints"][0]
        assert waypoint["distance"] < 100, "Cámara demasiado alejada de una vía"
        snapped.append(round(waypoint["distance"], 2))
    pairs = []
    for i, a in enumerate(POINTS):
        for j, b in enumerate(POINTS):
            if i == j:
                continue
            coordinates = f"{a[0]},{a[1]};{b[0]},{b[1]}"
            routes = get(f"/route/v1/driving/{coordinates}?alternatives=3&overview=full&geometries=geojson&radiuses=100;100")["routes"]
            assert all(r["distance"] > 0 and r["duration"] > 0 and len(r["geometry"]["coordinates"]) >= 2 for r in routes)
            pairs.append({"from": i + 1, "to": j + 1, "alternatives": len(routes),
                          "distance_m": routes[0]["distance"], "duration_s": routes[0]["duration"]})
    coordinates = ";".join(f"{lng},{lat}" for lng, lat in POINTS)
    table = get(f"/table/v1/driving/{coordinates}?annotations=distance,duration")
    for key in ("distances", "durations"):
        assert len(table[key]) == 4
        assert all(len(row) == 4 and all(isinstance(v, (int, float)) and v >= 0 for v in row) for row in table[key])
        assert all(table[key][i][i] == 0 for i in range(4))
    return {"status": "passed", "nearest_m": snapped, "pairs": pairs, "table_size": "4x4"}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default="http://127.0.0.1:5000")
    print(json.dumps(check(parser.parse_args().url), indent=2))
