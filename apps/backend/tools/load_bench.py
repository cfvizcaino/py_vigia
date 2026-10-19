"""Benchmark de carga controlada de la alternativa B (edges → central), contra una central real.

Cada nodo simulado se comporta como el edge: genera un Detection Envelope 1.1 cada
``interval`` segundos (vehículos que aparecen, se siguen y se van), lo encola y lo envía
en orden con su token; si falla, reintenta con retroceso exponencial (store-and-forward).
El 5 % de los eventos entregados se reenvía a propósito: deben volver como ``duplicate``.

Fases:
  ingest  escalones de nodos e intervalo hasta encontrar la saturación
  query   operadores concurrentes consultando la central
  fault   carga constante mientras se reinicia el backend (impacto de fallos)

Umbrales de aceptación (RNF-01/02 del informe): ingestión p95 < 500 ms y ≥ 10 msg/s
sostenidos; 0 eventos perdidos y 0 duplicados lógicos; consulta p95 < 2 s con hasta 10
operadores; tras un reinicio del backend, entrega completa y cola drenada en < 60 s.

  .venv/bin/python tools/load_bench.py --secrets bench-secrets.json --base https://HOST --output resultados.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import statistics
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

DIRECTIONS = ["izquierda-a-derecha", "derecha-a-izquierda", "arriba-a-abajo", "abajo-a-arriba", "indeterminada"]
COLORS = ["white", "gray", "black", "red", "blue", None]


def iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def percentile(values: list[float], q: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, max(0, round(q / 100 * len(ordered) + 0.5) - 1))]


@dataclass
class Stats:
    latencies_ms: list[float] = field(default_factory=list)  # one HTTP request
    delays_ms: list[float] = field(default_factory=list)  # generatedAt → accepted (incl. queue)
    generated: int = 0
    accepted: int = 0
    duplicates_expected: int = 0
    duplicates_ok: int = 0
    duplicates_wrong: int = 0
    errors: dict[str, int] = field(default_factory=dict)

    def error(self, kind: str) -> None:
        self.errors[kind] = self.errors.get(kind, 0) + 1


class Node:
    """One simulated edge with its own connection, session, sequence and outbox."""

    def __init__(self, camera: str, token: str, base: str, interval: float, stats: Stats):
        self.camera, self.token, self.interval, self.stats = camera, token, interval, stats
        self.client = httpx.AsyncClient(base_url=base, timeout=10.0, headers={"X-Vigia-Device-Token": token})
        self.session = str(uuid.uuid4())
        self.sequence = 0
        self.frame = 0
        self.tracks: dict[int, dict] = {}
        self.next_track = 1
        self.queue: deque[tuple[float, dict]] = deque()

    def _envelope(self, now: datetime) -> dict:
        # Vehicles appear (~1 every 3 envelopes) and stay 3-6 envelopes, like a street.
        for track_id in [t for t, track in self.tracks.items() if track["left"] <= 0]:
            del self.tracks[track_id]
        if random.random() < 0.35:
            self.tracks[self.next_track] = {"first": now, "left": random.randint(3, 6), "type": random.choice(["car", "car", "motorcycle"]),
                                            "color": random.choice(COLORS), "direction": random.choice(DIRECTIONS),
                                            "confidence": round(random.uniform(0.4, 0.95), 4)}
            self.next_track += 1
        detections = []
        for track_id, track in self.tracks.items():
            track["left"] -= 1
            x = random.randint(0, 1500)
            detections.append({
                "trackId": track_id, "vehicleType": track["type"], "confidence": track["confidence"],
                "firstSeen": iso(track["first"]), "lastSeen": iso(now), "direction": track["direction"],
                "boundingBox": [x, 300, x + 180, 420], "color": track["color"], "make": None, "model": None,
                "licensePlate": None,
            })
        self.sequence += 1
        self.frame += int(self.interval * 8)
        return {
            "schemaVersion": "1.1", "eventId": str(uuid.uuid4()), "sessionId": self.session,
            "sequenceNumber": self.sequence, "cameraId": self.camera, "generatedAt": iso(now),
            "nodeVersion": "bench-1.0", "model": "bench", "modelVersion": "bench", "modelDigest": None,
            "frameNumber": self.frame, "detections": detections,
        }

    async def produce(self, stop_at: float) -> None:
        await asyncio.sleep(random.uniform(0, self.interval))  # nodes are not synchronized
        while time.monotonic() < stop_at:
            self.queue.append((time.monotonic(), self._envelope(datetime.now(timezone.utc))))
            self.stats.generated += 1
            await asyncio.sleep(self.interval)

    async def _post(self, envelope: dict) -> httpx.Response | None:
        started = time.perf_counter()
        try:
            response = await self.client.post("/api/v1/ingest/detections", json=envelope)
        except httpx.HTTPError as exc:
            self.stats.error(type(exc).__name__)
            return None
        self.stats.latencies_ms.append((time.perf_counter() - started) * 1000)
        return response

    async def deliver(self, produce_done: asyncio.Event, drain_until: float) -> None:
        backoff = 0.5
        while True:
            if not self.queue:
                if produce_done.is_set() or time.monotonic() > drain_until:
                    return
                await asyncio.sleep(0.05)
                continue
            if time.monotonic() > drain_until:
                return
            created, envelope = self.queue[0]
            response = await self._post(envelope)
            if response is None or response.status_code >= 500 or response.status_code == 429:
                if response is not None:
                    self.stats.error(f"http-{response.status_code}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 8)
                continue
            backoff = 0.5
            self.queue.popleft()
            if response.status_code != 202:
                self.stats.error(f"http-{response.status_code}")
                continue
            self.stats.accepted += 1
            self.stats.delays_ms.append((time.monotonic() - created) * 1000)
            if random.random() < 0.05:  # deliberate resend of a delivered event
                self.stats.duplicates_expected += 1
                again = await self._post(envelope)
                if again is not None and again.status_code == 202 and again.json().get("status") == "duplicate":
                    self.stats.duplicates_ok += 1
                else:
                    self.stats.duplicates_wrong += 1


async def run_nodes(secrets: dict, base: str, count: int, interval: float, duration: float, drain: float,
                    during=None) -> tuple[Stats, list[Node]]:
    stats = Stats()
    cameras = sorted(secrets["tokens"])[:count]
    nodes = [Node(c, secrets["tokens"][c], base, interval, stats) for c in cameras]
    stop_at = time.monotonic() + duration
    produce_done = asyncio.Event()
    deliverers = [asyncio.create_task(n.deliver(produce_done, stop_at + drain)) for n in nodes]
    side = asyncio.create_task(during()) if during else None
    await asyncio.gather(*(n.produce(stop_at) for n in nodes))
    produce_done.set()
    await asyncio.gather(*deliverers)
    if side:
        await side
    for node in nodes:
        await node.client.aclose()
    return stats, nodes


def summarize(stats: Stats, nodes: list[Node], interval: float, duration: float) -> dict:
    backlog = sum(len(n.queue) for n in nodes)
    total_errors = sum(stats.errors.values())
    return {
        "nodes": len(nodes), "interval_s": interval, "duration_s": duration,
        "offered_msg_s": round(len(nodes) / interval, 1),
        "delivered_msg_s": round(stats.accepted / duration, 1),
        "generated": stats.generated, "accepted": stats.accepted, "lost": backlog,
        "http_mean_ms": round(statistics.mean(stats.latencies_ms), 1) if stats.latencies_ms else 0,
        "http_p50_ms": round(percentile(stats.latencies_ms, 50) or 0, 1),
        "http_p95_ms": round(percentile(stats.latencies_ms, 95) or 0, 1),
        "http_p99_ms": round(percentile(stats.latencies_ms, 99) or 0, 1),
        "http_max_ms": round(max(stats.latencies_ms, default=0), 1),
        "delivery_p95_ms": round(percentile(stats.delays_ms, 95) or 0, 1),
        "delivery_max_ms": round(max(stats.delays_ms, default=0), 1),
        "errors": stats.errors, "error_rate": round(total_errors / max(1, len(stats.latencies_ms) + total_errors), 4),
        "duplicates_expected": stats.duplicates_expected, "duplicates_ok": stats.duplicates_ok,
        "duplicates_wrong": stats.duplicates_wrong,
    }


async def phase_ingest(secrets: dict, base: str, steps: list[tuple[int, float]], duration: float) -> list[dict]:
    results = []
    for count, interval in steps:
        stats, nodes = await run_nodes(secrets, base, count, interval, duration, drain=30)
        row = summarize(stats, nodes, interval, duration)
        results.append(row)
        print(json.dumps(row), flush=True)
        # Protect the pilot server: stop escalating once it is clearly saturated.
        if row["http_p95_ms"] > 5000 or row["error_rate"] > 0.2:
            print("Saturación clara: se detiene la escalada", flush=True)
            break
        await asyncio.sleep(10)
    return results


async def phase_query(secrets: dict, base: str, concurrency: list[int], duration: float) -> list[dict]:
    async with httpx.AsyncClient(base_url=base, timeout=30.0) as client:
        login = await client.post("/api/v1/auth/login", json={"email": secrets["email"], "password": secrets["password"]})
        login.raise_for_status()
        headers = {"Authorization": f"Bearer {login.json()['token']}"}
    results = []
    lat0, lng0 = secrets["origin"]
    step, side = secrets["step_deg"], secrets["side"]
    for workers in concurrency:
        latencies, statuses, detections = [], {}, []

        async def worker(stop_at: float) -> None:
            async with httpx.AsyncClient(base_url=base, timeout=30.0, headers=headers) as c:
                while time.monotonic() < stop_at:
                    row, col = random.randrange(side), random.randrange(side)
                    now = datetime.now(timezone.utc)
                    params = {"lat": lat0 + row * step, "lng": lng0 + col * step, "radius_m": 600,
                              "time_from": iso(now - timedelta(minutes=3)), "time_to": iso(now),
                              "vehicle_type": "car"}
                    if random.random() < 0.5:
                        params["color"] = random.choice(["white", "gray", "red"])
                    started = time.perf_counter()
                    try:
                        response = await c.get("/api/v1/queries", params=params)
                        latencies.append((time.perf_counter() - started) * 1000)
                        statuses[response.status_code] = statuses.get(response.status_code, 0) + 1
                        if response.status_code == 200:
                            detections.append(response.json().get("candidate_detection_count", 0))
                    except httpx.HTTPError as exc:
                        statuses[type(exc).__name__] = statuses.get(type(exc).__name__, 0) + 1

        stop_at = time.monotonic() + duration
        await asyncio.gather(*(worker(stop_at) for _ in range(workers)))
        row = {"operators": workers, "queries": len(latencies),
               "mean_ms": round(statistics.mean(latencies), 1) if latencies else 0,
               "p50_ms": round(percentile(latencies, 50) or 0, 1),
               "p95_ms": round(percentile(latencies, 95) or 0, 1), "p99_ms": round(percentile(latencies, 99) or 0, 1),
               "max_ms": round(max(latencies, default=0), 1),
               "queries_s": round(len(latencies) / duration, 2), "statuses": {str(k): v for k, v in statuses.items()},
               "mean_candidates": round(statistics.mean(detections), 1) if detections else 0}
        results.append(row)
        print(json.dumps(row), flush=True)
    return results


async def phase_fault(secrets: dict, base: str, ssh: list[str], count: int, duration: float, restart_at: float) -> dict:
    events: dict[str, float] = {}

    async def restart() -> None:
        await asyncio.sleep(restart_at)
        events["restart_started"] = time.monotonic()
        process = await asyncio.create_subprocess_exec(*ssh, "cd /opt/vigia && docker compose restart backend",
                                                       stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        await process.wait()
        events["restart_returned"] = time.monotonic()
        async with httpx.AsyncClient(base_url=base, timeout=5.0) as client:
            while True:
                try:
                    if (await client.get("/health")).status_code == 200:
                        events["healthy_again"] = time.monotonic()
                        return
                except httpx.HTTPError:
                    pass
                await asyncio.sleep(0.5)

    started = time.monotonic()
    stats, nodes = await run_nodes(secrets, base, count, 2.0, duration, drain=120, during=restart)
    finished = time.monotonic()
    row = summarize(stats, nodes, 2.0, duration)
    row["restart_at_s"] = restart_at
    row["unavailable_s"] = round(events.get("healthy_again", finished) - events.get("restart_started", started), 1)
    row["drain_after_recovery_s"] = round(finished - max(events.get("healthy_again", finished), started + duration), 1)
    print(json.dumps(row), flush=True)
    return row


async def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--secrets", type=Path, required=True)
    parser.add_argument("--base", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--phases", default="ingest,query,fault")
    parser.add_argument("--step-seconds", type=float, default=60)
    parser.add_argument("--steps", default="4x2,10x2,25x2,50x2,100x2,100x1,100x0.5,100x0.25",
                        help="Escalones de ingestión NODOSxINTERVALO; por defecto, hasta la saturación")
    parser.add_argument("--ssh", default="ssh -i ~/.ssh/vigia_azure vigia@vigia-5dfe.mexicocentral.cloudapp.azure.com")
    args = parser.parse_args()
    secrets = json.loads(args.secrets.read_text(encoding="utf-8"))
    results = json.loads(args.output.read_text(encoding="utf-8")) if args.output.exists() else {}
    phases = args.phases.split(",")
    if "ingest" in phases:
        steps = [(int(n), float(i)) for n, i in (step.split("x") for step in args.steps.split(","))]
        results["ingest"] = await phase_ingest(secrets, args.base, steps, args.step_seconds)
    if "query" in phases:
        # Operators query while 25 edges keep publishing, as in operation.
        concurrency = [1, 5, 10]
        background = asyncio.create_task(run_nodes(secrets, args.base, 25, 2.0,
                                                   len(concurrency) * args.step_seconds + 5, drain=30))
        await asyncio.sleep(5)
        results["query"] = await phase_query(secrets, args.base, concurrency, args.step_seconds)
        stats, nodes = await background
        results["query_background_ingest"] = summarize(stats, nodes, 2.0, len(concurrency) * args.step_seconds + 5)
        print(json.dumps(results["query_background_ingest"]), flush=True)
    if "fault" in phases:
        import os
        ssh = [os.path.expanduser(part) for part in args.ssh.split()]
        results["fault"] = await phase_fault(secrets, args.base, ssh, 25, 180, restart_at=60)
    args.output.write_text(json.dumps(results, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
