"""Dataset sintético para probar puntajes y rutas probables (no es evidencia de campo).

Tres comandos:
  generate  Construye el JSON versionado a partir de OSRM local y una semilla fija.
  evaluate  Corre el ranking en memoria contra la verdad de terreno (sin base de datos).
  load      Carga el dataset en una base DEDICADA (p. ej. `vigia_scoring`) para verlo en la consola.

Los tiempos de viaje salen de duraciones OSRM multiplicadas por un factor de tráfico
aleatorio; por eso sirven para probar el algoritmo, no para calibrarlo. Las métricas
reales de P1.1 requieren recorridos de campo.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import random
import statistics
import uuid

from .geo import haversine_m
from .routing import DetectionPoint, RoadOption, RoutingConfig, reconstruct_routes

SCHEMA = "vigia-scoring-dataset/1"
DEFAULT_PATH = Path(__file__).resolve().parent.parent / "datasets" / "scoring" / "scoring-v1.json"
COLOMBIA = timezone(timedelta(hours=-5))
DAY = datetime(2026, 9, 15, 7, 0, tzinfo=COLOMBIA)
BLOCK = timedelta(minutes=20)
DIRECTIONS = ("izquierda-a-derecha", "derecha-a-izquierda", "arriba-a-abajo", "abajo-a-arriba")
NAMESPACE = uuid.UUID("8a4f2c56-3c55-4f43-9d2e-7c1d8a0b5e11")

# Snapped to the OSRM graph (nearest < 50 m) inside the validated Barranquilla extract.
CAMERAS = (
    ("SC-01", "Carrera 58 · norte", 11.01277, -74.817474),
    ("SC-02", "Carrera 58 · sur", 11.010934, -74.814833),
    ("SC-03", "Calle 78", 11.004982, -74.806847),
    ("SC-04", "Sector Calle 72", 11.001541, -74.804028),
    ("SC-05", "Carrera 52", 11.008007, -74.819488),
    ("SC-06", "Carrera 65", 11.014486, -74.811027),
    ("SC-07", "Calle 81", 11.008375, -74.809824),
    ("SC-08", "Carrera 64", 11.011038, -74.80599),
)


@dataclass(frozen=True)
class Vehicle:
    label: str
    vehicle_type: str
    color: str | None
    path: tuple[str, ...]
    start_s: float = 60
    missed: tuple[int, ...] = ()          # path positions passed without a detection
    dwell_s: dict | None = None           # {position: extra seconds stopped before leaving it}
    confidence: tuple[float, float] = (.78, .95)


# Each scenario lives in its own 20-minute block so the operator query isolates it.
SCENARIOS = (
    {"key": "S01", "title": "Recorrido limpio", "challenge": "control",
     "query": {"vehicle_type": "car", "color": "white"},
     "vehicles": [Vehicle("blanco-limpio", "car", "white", ("SC-06", "SC-08", "SC-07", "SC-03"))]},
    {"key": "S02", "title": "Dos vehículos iguales que se cruzan", "challenge": "confusor",
     "query": {"vehicle_type": "car", "color": "silver"},
     "vehicles": [Vehicle("plata-a", "car", "silver", ("SC-01", "SC-02", "SC-07", "SC-03")),
                  Vehicle("plata-b", "car", "silver", ("SC-05", "SC-02", "SC-07", "SC-08"), start_s=95)]},
    {"key": "S03", "title": "Color no detectado", "challenge": "apariencia incompleta",
     "query": {"vehicle_type": "motorcycle"},
     "vehicles": [Vehicle("moto-sin-color", "motorcycle", None, ("SC-02", "SC-07", "SC-08", "SC-06"))]},
    {"key": "S04", "title": "Cámara intermedia sin detección", "challenge": "observación perdida",
     "query": {"vehicle_type": "car", "color": "red"},
     "vehicles": [Vehicle("rojo-hueco", "car", "red", ("SC-05", "SC-01", "SC-02", "SC-07"), missed=(2,))]},
    {"key": "S05", "title": "Parada larga entre cámaras", "challenge": "tiempo atípico",
     "query": {"vehicle_type": "car", "color": "blue"},
     "vehicles": [Vehicle("azul-parada", "car", "blue", ("SC-03", "SC-07", "SC-06"), dwell_s={1: 480})]},
    # Two different green cars 50 s apart at cameras ~1.8 km apart by road (~127 km/h): must not link.
    {"key": "S06", "title": "Salto físicamente imposible", "challenge": "enlace imposible",
     "query": {"vehicle_type": "car", "color": "green"},
     "vehicles": [Vehicle("verde-1", "car", "green", ("SC-01",)),
                  Vehicle("verde-2", "car", "green", ("SC-03",), start_s=110)]},
    {"key": "S07", "title": "Hora pico: seis autos blancos", "challenge": "densidad",
     "query": {"vehicle_type": "car", "color": "white"},
     "vehicles": [Vehicle("pico-1", "car", "white", ("SC-01", "SC-02", "SC-07"), start_s=30),
                  Vehicle("pico-2", "car", "white", ("SC-05", "SC-02", "SC-07", "SC-03"), start_s=55),
                  Vehicle("pico-3", "car", "white", ("SC-06", "SC-07", "SC-03"), start_s=70),
                  Vehicle("pico-4", "car", "white", ("SC-08", "SC-07", "SC-02"), start_s=90),
                  Vehicle("pico-5", "car", "white", ("SC-02", "SC-07", "SC-08"), start_s=120),
                  Vehicle("pico-6", "car", "white", ("SC-03", "SC-07", "SC-06"), start_s=140)]},
    {"key": "S08", "title": "Detecciones de baja confianza", "challenge": "detector débil",
     "query": {"vehicle_type": "car", "color": "black"},
     "vehicles": [Vehicle("negro-debil", "car", "black", ("SC-08", "SC-07", "SC-03", "SC-04"), confidence=(.35, .5))]},
    {"key": "S09", "title": "Sentido contrario plausible", "challenge": "vía de un sentido",
     "query": {"vehicle_type": "car", "color": "gray"},
     "vehicles": [Vehicle("gris-correcto", "car", "gray", ("SC-01", "SC-02")),
                  Vehicle("gris-otro-a", "car", "gray", ("SC-02",), start_s=300),
                  Vehicle("gris-otro-b", "car", "gray", ("SC-01",), start_s=360)]},
    {"key": "S10", "title": "Solo ruido de fondo", "challenge": "sin trayectoria",
     "query": {"vehicle_type": "car", "color": "yellow"},
     "vehicles": []},
)
NOISE_PER_BLOCK = 6
NOISE_COLORS = ("white", "white", "silver", "gray", "black", "red", "blue", "yellow")


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _parse(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def generate(osrm_url: str, seed: int = 20260915) -> dict:
    import httpx
    from .models import Device
    from .road_network import fetch_options

    rng = random.Random(seed)
    devices = {cid: Device(external_id=cid, name=name, lat=lat, lng=lng) for cid, name, lat, lng in CAMERAS}
    links = []
    with httpx.Client(base_url=osrm_url, timeout=15, trust_env=False) as client:
        for a in devices.values():
            for b in devices.values():
                if a is not b:
                    links.append({"from": a.external_id, "to": b.external_id, "options": fetch_options(client, a, b)})
    fastest = {(l["from"], l["to"]): l["options"][0] for l in links if l["options"]}

    vehicles, detections, cases = [], [], []
    counter = 0

    def add(camera, vehicle_id, kind, color, confidence, when):
        nonlocal counter
        counter += 1
        detections.append({"id": f"d{counter:04d}", "camera_id": camera, "vehicle_id": vehicle_id,
                           "vehicle_type": kind, "color": color, "direction": rng.choice(DIRECTIONS),
                           "confidence": round(confidence, 3), "observed_at": _iso(when)})

    for index, scenario in enumerate(SCENARIOS):
        start = DAY + index * BLOCK
        for vehicle in scenario["vehicles"]:
            vehicle_id = f"{scenario['key']}-{vehicle.label}"
            vehicles.append({"id": vehicle_id, "scenario": scenario["key"], "label": vehicle.label,
                             "vehicle_type": vehicle.vehicle_type, "color": vehicle.color, "path": list(vehicle.path)})
            when = start + timedelta(seconds=vehicle.start_s)
            for position, camera in enumerate(vehicle.path):
                if position > 0:
                    option = fastest[(vehicle.path[position - 1], camera)]
                    # Urban traffic is slower than OSRM free-flow; the factor is unknown to the ranker.
                    when += timedelta(seconds=option["duration_s"] * rng.uniform(1.05, 1.9))
                if position not in vehicle.missed:
                    add(camera, vehicle_id, vehicle.vehicle_type, vehicle.color, rng.uniform(*vehicle.confidence), when)
                when += timedelta(seconds=(vehicle.dwell_s or {}).get(position, 0))
        for _ in range(NOISE_PER_BLOCK):
            kind = "car" if rng.random() < .75 else "motorcycle"
            add(rng.choice(CAMERAS)[0], None, kind, rng.choice(NOISE_COLORS), rng.uniform(.5, .95),
                start + timedelta(seconds=rng.uniform(0, BLOCK.total_seconds() - 60)))
        cases.append({"id": scenario["key"], "title": scenario["title"], "challenge": scenario["challenge"],
                      "center_camera": "SC-07", "radius_m": 2500, "time_from": _iso(start), "time_to": _iso(start + BLOCK),
                      "vehicle_type": scenario["query"].get("vehicle_type"), "color": scenario["query"].get("color")})

    detections.sort(key=lambda d: (d["observed_at"], d["id"]))
    return {
        "schema": SCHEMA, "version": "1.0.0", "synthetic": True, "seed": seed,
        "generated_at": _iso(datetime.now(timezone.utc)),
        "notice": "Datos sintéticos para probar puntajes y rutas; no son recorridos reales ni sirven para calibrar.",
        "timezone_note": "Horas en UTC; los bloques empiezan a las 07:00 de Colombia del 15/09/2026.",
        "road_source": {"engine": "OSRM v6.0.0 (perfil car.lua, MLD)", "extract": "OpenStreetMap bbox -74.825,10.996,-74.798,11.018 (30/09/2026), ODbL",
                        "travel_model": "duración OSRM de la opción principal × U(1.05, 1.9)"},
        "cameras": [{"external_id": cid, "name": name, "lat": lat, "lng": lng} for cid, name, lat, lng in CAMERAS],
        "road_links": links, "vehicles": vehicles, "detections": detections, "cases": cases,
    }


def load_dataset(path: Path = DEFAULT_PATH) -> dict:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("schema") != SCHEMA:
        raise ValueError(f"Esquema no soportado: {data.get('schema')}")
    return data


def _links(data: dict) -> dict:
    return {(l["from"], l["to"]): [RoadOption(**{k: (tuple(map(tuple, o["geometry"])) if k == "geometry" else o[k])
                                               for k in ("distance_m", "duration_s", "weight", "geometry", "source", "option_index")})
                                   for o in l["options"]]
            for l in data["road_links"]}


def _candidates(data: dict, case: dict) -> list[dict]:
    """Same selection as the API: cameras inside the radius, time window and filters."""
    cameras = {c["external_id"]: c for c in data["cameras"]}
    center = cameras[case["center_camera"]]
    nearby = {cid for cid, c in cameras.items() if haversine_m(center["lat"], center["lng"], c["lat"], c["lng"]) <= case["radius_m"]}
    start, end = _parse(case["time_from"]), _parse(case["time_to"])
    return [d for d in data["detections"]
            if d["camera_id"] in nearby and start <= _parse(d["observed_at"]) <= end
            and (case["vehicle_type"] is None or d["vehicle_type"] == case["vehicle_type"])
            and (case["color"] is None or d["color"] == case["color"])]


def evaluate(data: dict, config: RoutingConfig | None = None, top_k: int = 3) -> dict:
    links = _links(data)
    cfg = config or RoutingConfig()
    results, pooled_pairs, pooled_false = [], 0, 0
    for case in data["cases"]:
        candidates = _candidates(data, case)
        owner = {d["id"]: d["vehicle_id"] for d in candidates}
        points = [DetectionPoint(d["id"], d["camera_id"], d["vehicle_type"], d["color"], d["direction"],
                                 d["confidence"], _parse(d["observed_at"])) for d in candidates]
        routes = reconstruct_routes(points, links, vehicle_type=case["vehicle_type"], color=case["color"], config=cfg)
        by_vehicle = defaultdict(list)
        for d in sorted(candidates, key=lambda d: (d["observed_at"], d["id"])):
            if d["vehicle_id"]:
                by_vehicle[d["vehicle_id"]].append(d["id"])
        truths = {vid: tuple(ids) for vid, ids in by_vehicle.items() if len(ids) >= 2}
        ranked = [r.detection_ids for r in routes]
        truth_rows = []
        for vid, ids in truths.items():
            rank = ranked.index(ids) + 1 if ids in ranked else None
            best = max((len(set(ids) & set(r)) / len(set(ids) | set(r)) for r in ranked[:top_k]), default=0.0)
            truth_rows.append({"vehicle": vid, "detections": len(ids), "rank": rank, f"best_jaccard_top{top_k}": round(best, 3)})
        pairs = [(a, b) for r in ranked[:top_k] for a, b in zip(r, r[1:])]
        false = [(a, b) for a, b in pairs if owner[a] is None or owner[a] != owner[b]]
        pooled_pairs += len(pairs)
        pooled_false += len(false)
        top = routes[0] if routes else None
        results.append({
            "case": case["id"], "title": case["title"], "challenge": case["challenge"],
            "candidates": len(candidates), "routes": len(routes), "truths": truth_rows,
            "top1": {"cameras": list(top.camera_ids), "score": top.confidence} if top else None,
            "false_links_topk": len(false), "links_topk": len(pairs),
        })
    truth_rows = [t for r in results for t in r["truths"]]

    def recall(k):
        return round(sum(1 for t in truth_rows if t["rank"] and t["rank"] <= k) / len(truth_rows), 3) if truth_rows else None

    return {
        "dataset": {"schema": data["schema"], "version": data["version"], "synthetic": data["synthetic"]},
        "config": {"weights": {"detection": cfg.detection_weight, "time": cfg.time_weight, "appearance": cfg.appearance_weight, "road": cfg.road_weight},
                   "time_factor": cfg.time_factor, "time_sigma": cfg.time_sigma, "top_k": top_k},
        "summary": {"trajectories": len(truth_rows), "recall_at_1": recall(1), f"recall_at_{top_k}": recall(top_k),
                    f"mean_best_jaccard_top{top_k}": round(statistics.mean(t[f"best_jaccard_top{top_k}"] for t in truth_rows), 3) if truth_rows else None,
                    "false_link_rate_topk": round(pooled_false / pooled_pairs, 3) if pooled_pairs else 0.0},
        "cases": results,
    }


def format_report(report: dict) -> str:
    s = report["summary"]
    k = report["config"]["top_k"]
    lines = [f"Dataset {report['dataset']['version']} (sintético) · top-{k}",
             f"Trayectorias: {s['trajectories']} · recall@1 {s['recall_at_1']} · recall@{k} {s[f'recall_at_{k}']} · "
             f"Jaccard medio {s[f'mean_best_jaccard_top{k}']} · enlaces falsos {s['false_link_rate_topk']}", ""]
    for case in report["cases"]:
        truths = ", ".join(f"{t['vehicle'].split('-', 1)[1]}→{t['rank'] or '✗'}" for t in case["truths"]) or "sin trayectoria esperada"
        top = " → ".join(case["top1"]["cameras"]) + f" ({case['top1']['score']:.2f})" if case["top1"] else "sin rutas"
        lines.append(f"{case['case']} {case['title']:<36} candidatas {case['candidates']:>2} · rutas {case['routes']:>2} · "
                     f"verdad {truths} · falsos {case['false_links_topk']}/{case['links_topk']} · top1 {top}")
    return "\n".join(lines)


def load_into_database(db, data: dict) -> dict:
    """Replaces the dataset in a dedicated database. Refuses databases with real activity."""
    from sqlalchemy import delete, func, select
    from .models import Detection, Device, DeviceLink, EdgeObservation, IngestedEvent, Query, RouteResult, RouteResultDetection, utc_now

    foreign = db.scalar(select(func.count()).select_from(Device).where(~Device.external_id.startswith("SC-")))
    if foreign or db.scalar(select(func.count()).select_from(IngestedEvent)):
        raise ValueError("La base tiene cámaras o eventos reales; usa una base dedicada al dataset (p. ej. vigia_scoring)")
    for model in (RouteResultDetection, RouteResult, Query, EdgeObservation, DeviceLink, Detection, Device):
        db.execute(delete(model))
    devices = {}
    for camera in data["cameras"]:
        device = Device(external_id=camera["external_id"], name=f"{camera['name']} (dataset)", kind="simulated",
                        status="simulated", lat=camera["lat"], lng=camera["lng"])
        db.add(device)
        devices[camera["external_id"]] = device
    db.flush()
    for link in data["road_links"]:
        db.add(DeviceLink(from_device_id=devices[link["from"]].id, to_device_id=devices[link["to"]].id,
                          road_distance_m=link["options"][0]["distance_m"] if link["options"] else 0,
                          road_options=link["options"], road_source="osrm", road_updated_at=utc_now()))
    for d in data["detections"]:
        db.add(Detection(id=uuid.uuid5(NAMESPACE, f"{data['version']}:{d['id']}"), device_id=devices[d["camera_id"]].id,
                         vehicle_type=d["vehicle_type"], color=d["color"], direction=d["direction"],
                         confidence=d["confidence"], observed_at=_parse(d["observed_at"])))
    db.commit()
    return {"cameras": len(devices), "links": len(data["road_links"]), "detections": len(data["detections"])}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    gen = commands.add_parser("generate")
    gen.add_argument("--url", default=os.getenv("ROAD_ROUTER_URL", "http://127.0.0.1:5000"))
    gen.add_argument("--seed", type=int, default=20260915)
    gen.add_argument("--output", type=Path, default=DEFAULT_PATH)
    ev = commands.add_parser("evaluate")
    ev.add_argument("--dataset", type=Path, default=DEFAULT_PATH)
    ev.add_argument("--json", type=Path, help="Guarda el informe completo en un archivo nuevo")
    ld = commands.add_parser("load")
    ld.add_argument("--dataset", type=Path, default=DEFAULT_PATH)
    ld.add_argument("--confirm-database", required=True, metavar="NOMBRE",
                    help="Nombre exacto de la base dedicada que se va a reemplazar (p. ej. vigia_scoring)")
    args = parser.parse_args()
    try:
        if args.command == "generate":
            if args.output.exists():
                raise ValueError(f"{args.output} ya existe; versiona un archivo nuevo en vez de sobrescribirlo")
            data = generate(args.url, args.seed)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
            print(f"{args.output}: {len(data['detections'])} detecciones, {len(data['vehicles'])} vehículos, {len(data['cases'])} casos")
        elif args.command == "evaluate":
            report = evaluate(load_dataset(args.dataset))
            print(format_report(report))
            if args.json:
                with open(args.json, "x", encoding="utf-8") as target:
                    json.dump(report, target, ensure_ascii=False, indent=2)
        else:
            from .db import SessionLocal, init_db
            init_db()
            with SessionLocal() as db:
                # An empty pilot database passes the content checks, so require the operator to name the target.
                target = db.get_bind().url.database or ""
                if args.confirm_database != Path(target).name or "scoring" not in Path(target).name:
                    raise ValueError(f"La base actual es '{Path(target).name}'. Usa una base cuyo nombre contenga 'scoring' y confírmala con --confirm-database")
                print(load_into_database(db, load_dataset(args.dataset)))
    except (ValueError, OSError) as exc:
        parser.exit(1, f"No se completó: {exc}\n")


if __name__ == "__main__":
    main()
