"""Sensibilidad del ranking a sus umbrales y pesos, sobre el dataset sintético de puntajes.

Varía un parámetro a la vez desde RoutingConfig por defecto y reporta recall@1, recall@3,
Jaccard, enlaces falsos y si los casos de control siguen sanos (S06: salto imposible sin
rutas; S10: ruido sin rutas). Justifica los umbrales como parámetros de laboratorio
medidos, no como constantes universales.

  cd apps/backend && .venv/bin/python tools/scoring_sensitivity.py --json ../../docs/evidence/sensibilidad.json
"""
from __future__ import annotations

import argparse
import json
import time
from dataclasses import asdict, replace
from pathlib import Path

from vigia_backend.routing import RoutingConfig
from vigia_backend.scoring_dataset import evaluate, load_dataset

BASE = RoutingConfig()
COMPONENTS = ("detection", "time", "appearance", "road")


def without(component: str) -> RoutingConfig:
    """Ablation: the component weighs 0 and the rest keep their proportions."""
    weights = {c: getattr(BASE, f"{c}_weight") for c in COMPONENTS}
    removed = weights.pop(component)
    scale = 1 / (1 - removed)
    return replace(BASE, **{f"{c}_weight": w * scale for c, w in weights.items()}, **{f"{component}_weight": 0.0})


def variants() -> list[tuple[str, str, RoutingConfig]]:
    rows = [("base", "Configuración por defecto", BASE)]
    for low, high in ((3, 70), (12, 70), (8, 50), (8, 90), (8, 120)):
        rows.append(("velocidad", f"{low}–{high} km/h", replace(BASE, min_speed_kmh=low, max_speed_kmh=high)))
    for limit in (1000, 1500, 3000, 5000):
        rows.append(("enlace máximo", f"{limit} m", replace(BASE, max_road_m=limit)))
    for near in (250, 1000, 2000):
        rows.append(("hueco distante", f"desde {near} m", replace(BASE, nearby_road_m=near)))
    for component in COMPONENTS:
        rows.append(("ablación", f"sin {component}", without(component)))
    rows.append(("pesos", "iguales (0,25 c/u)", replace(BASE, detection_weight=.25, time_weight=.25,
                                                         appearance_weight=.25, road_weight=.25)))
    for sigma in (.35, 1.0):
        rows.append(("tolerancia temporal", f"sigma {sigma}", replace(BASE, time_sigma=sigma)))
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    data = load_dataset()
    results = []
    for group, label, config in variants():
        started = time.perf_counter()
        report = evaluate(data, config)
        elapsed_ms = (time.perf_counter() - started) * 1000
        cases = {c["case"]: c for c in report["cases"]}
        s = report["summary"]
        results.append({
            "group": group, "variant": label,
            "recall_at_1": s["recall_at_1"], "recall_at_3": s["recall_at_3"],
            "jaccard": s["mean_best_jaccard_top3"], "false_links": s["false_link_rate_topk"],
            "s06_routes": cases["S06"]["routes"], "s10_routes": cases["S10"]["routes"],
            "evaluation_ms": round(elapsed_ms, 1),
            "config": asdict(config),
        })
    print("| Grupo | Variante | recall@1 | recall@3 | Jaccard | Enlaces falsos | S06 rutas | S10 rutas |")
    print("|---|---|---:|---:|---:|---:|---:|---:|")
    for r in results:
        print(f"| {r['group']} | {r['variant']} | {r['recall_at_1']:.3f} | {r['recall_at_3']:.3f} | {r['jaccard']:.3f} | "
              f"{r['false_links']:.2f} | {r['s06_routes']} | {r['s10_routes']} |")
    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
