"""Prueba de resiliencia P1.2 contra el stack Compose real (perfil `resilience`).

Nodo edge simulado con el publicador REAL (cola persistente en disco) → proxy de fallas →
backend-resilience → PostgreSQL. No usa cámara ni YOLO: los snapshots son sintéticos y salen
cada 2 s, como en el runtime. Fases:

  1. base            tráfico normal
  2. corte de red    el proxy retiene las conexiones sin responder (como un enlace caído);
                     a mitad del corte se reinicia el nodo con la cola llena (nueva sesión)
  3. acuses perdidos el backend guarda el evento pero la respuesta no llega: el nodo reenvía
  4. caída del backend (contenedor detenido) y luego de PostgreSQL, 15 s cada una

Verifica en la base que cada evento generado quede una sola vez y mide cola, drenaje y latencia.

Uso, desde la raíz y con el venv del backend:
  apps/backend/.venv/bin/python infra/resilience/run.py --outage 300 --output resultados.json
Con el Docker rootless del proyecto: VIGIA_COMPOSE="bash infra/docker-local.sh compose".
"""
from __future__ import annotations

import argparse
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import random
import socket
import statistics
import subprocess
import sys
import tempfile
import threading
import time
import uuid

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "apps" / "vision"))
from vigia_vision.events import TrackState, build_snapshot  # noqa: E402
from vigia_vision.publisher import SnapshotPublisher  # noqa: E402

CAMERA = "RES-01"
DATABASE = "vigia_resilience"
BACKEND_PORT = 8300


def env_value(key: str) -> str:
    if os.getenv(key):
        return os.environ[key]
    for line in (ROOT / ".env").read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    raise SystemExit(f"Falta {key} en .env")


def utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


# --------------------------------------------------------------------------- proxy de fallas
def read_http(conn: socket.socket) -> bytes | None:
    data = b""
    while b"\r\n\r\n" not in data:
        chunk = conn.recv(65536)
        if not chunk:
            return None
        data += chunk
    head, _, body = data.partition(b"\r\n\r\n")
    length = next((int(line.split(b":", 1)[1]) for line in head.split(b"\r\n") if line.lower().startswith(b"content-length:")), 0)
    while len(body) < length:
        chunk = conn.recv(65536)
        if not chunk:
            return None
        body += chunk
    return head + b"\r\n\r\n" + body


class FaultProxy:
    """Proxy HTTP/1.1 de una petición por conexión (urllib envía `Connection: close`)."""

    def __init__(self, upstream_port: int):
        self.upstream_port = upstream_port
        self.mode = "pass"  # pass | blackhole | drop-response
        self.stats = {"responses": {}, "duplicates_acknowledged": 0, "responses_dropped": 0,
                      "held_connections": 0, "upstream_unavailable": 0}
        self._lock = threading.Lock()
        self.server = socket.create_server(("127.0.0.1", 0))
        self.port = self.server.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _count(self, key, sub=None):
        with self._lock:
            if sub is None:
                self.stats[key] += 1
            else:
                self.stats[key][sub] = self.stats[key].get(sub, 0) + 1

    def _accept(self):
        while True:
            conn, _ = self.server.accept()
            threading.Thread(target=self._handle, args=(conn,), daemon=True).start()

    @staticmethod
    def _hold(conn: socket.socket):
        """Keep the client waiting without an answer until it gives up (its timeout)."""
        conn.settimeout(60)
        try:
            while conn.recv(4096):
                pass
        except OSError:
            pass

    def _handle(self, conn: socket.socket):
        with conn:
            conn.settimeout(30)
            try:
                request = read_http(conn)
            except OSError:
                return
            if request is None:
                return
            mode = self.mode
            if mode == "blackhole":
                self._count("held_connections")
                self._hold(conn)
                return
            try:
                with socket.create_connection(("127.0.0.1", self.upstream_port), timeout=20) as upstream:
                    upstream.sendall(request)
                    response = b""
                    while chunk := upstream.recv(65536):
                        response += chunk
            except OSError:
                self._count("upstream_unavailable")  # Backend restarting: the node sees a reset.
                return
            # An empty answer means the backend accepted the connection but was shutting down.
            status = response.split(b" ", 2)[1].decode() if response.startswith(b"HTTP/") else "sin-respuesta"
            self._count("responses", status)
            if b'"status":"duplicate"' in response:
                self._count("duplicates_acknowledged")
            if mode == "drop-response":
                self._count("responses_dropped")  # The central committed; the node never hears it.
                self._hold(conn)
                return
            try:
                conn.sendall(response)
            except OSError:
                pass


# --------------------------------------------------------------------------- nodo simulado
@dataclass
class Generated:
    event_id: str
    session_id: str
    generated_at: str
    phase: str


@dataclass
class SimulatedNode:
    outbox: Path
    url: str
    token: str
    phase_ref: list
    interval: float = 2.0
    seed: int = 7
    session_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    generated: list = field(default_factory=list)
    tracks_seen: set = field(default_factory=set)

    def __post_init__(self):
        self.publisher = SnapshotPublisher(self.url, self.token, self.outbox, timeout_seconds=10)
        self._rng = random.Random(f"{self.seed}-{self.session_id}")
        self._stop = threading.Event()
        self._tracks: dict[int, TrackState] = {}
        self._ttl: dict[int, int] = {}
        self._next_track = 1
        self._sequence = 0

    def start(self):
        self.publisher.start()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        """Like killing the process: generation and publishing stop, the outbox stays on disk."""
        self._stop.set()
        self._thread.join(timeout=5)
        self.publisher.stop()

    def _tick(self):
        now = utc_iso()
        for track_id in [t for t, left in self._ttl.items() if left <= 0]:
            self._tracks.pop(track_id)
            self._ttl.pop(track_id)
        if self._rng.random() < .5:
            track_id = self._next_track
            self._next_track += 1
            center = (self._rng.uniform(100, 500), self._rng.uniform(100, 300))
            self._tracks[track_id] = TrackState(track_id, self._rng.choice(["car", "car", "car", "motorcycle"]),
                                                round(self._rng.uniform(.6, .95), 3), now, now, center, center, [10, 10, 80, 60])
            self._ttl[track_id] = self._rng.randint(2, 6)
        for track_id, track in self._tracks.items():
            self._tracks[track_id] = TrackState(track.track_id, track.vehicle_type, track.confidence, track.first_seen, now,
                                                track.first_center, (track.last_center[0] + 20, track.last_center[1]), track.bounding_box)
            self._ttl[track_id] -= 1
            self.tracks_seen.add((track.track_id, track.first_seen))
        self._sequence += 1
        payload = build_snapshot(CAMERA, "simulado", self._sequence, self._tracks, session_id=self.session_id,
                                 sequence_number=self._sequence, node_version="0.2.0-resilience", model_version="simulado")
        if self.publisher.enqueue(payload):
            self.generated.append(Generated(payload["eventId"], self.session_id, payload["generatedAt"], self.phase_ref[0]))

    def _run(self):
        while not self._stop.wait(self.interval):
            self._tick()


# --------------------------------------------------------------------------- orquestación
def compose(*args: str):
    command = os.getenv("VIGIA_COMPOSE", "docker compose").split() + ["--profile", "resilience", *args]
    subprocess.run(command, cwd=ROOT, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def wait_backend_healthy(timeout=90):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", BACKEND_PORT), timeout=2) as s:
                s.sendall(b"GET /health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n")
                if b"200 OK" in s.recv(1024):
                    return
        except OSError:
            pass
        time.sleep(1)
    raise RuntimeError("backend-resilience no quedó sano")


def setup(sqlalchemy_url: str) -> str:
    """Registers the simulated camera and issues a 1-day credential in the dedicated database."""
    os.environ["DATABASE_URL"] = sqlalchemy_url
    sys.path.insert(0, str(ROOT / "apps" / "backend"))
    from sqlalchemy import select
    from vigia_backend.db import SessionLocal, init_db
    from vigia_backend.device_credentials import issue
    from vigia_backend.models import Device

    init_db()
    with SessionLocal() as db:
        if db.scalar(select(Device).where(Device.external_id == CAMERA)) is None:
            db.add(Device(external_id=CAMERA, name="Nodo simulado de resiliencia", kind="simulated", status="simulated", lat=11.0131, lng=-74.8172))
            db.commit()
        _, secret = issue(db, CAMERA, days=1)
        db.commit()
    return secret


def percentile(values, q):
    ordered = sorted(values)
    return round(ordered[min(len(ordered) - 1, int(round(q * (len(ordered) - 1))))], 3) if ordered else None


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--outage", type=int, default=300, help="Segundos de corte de red (P1.2 exige 300)")
    parser.add_argument("--baseline", type=int, default=60)
    parser.add_argument("--lost-ack", type=int, default=40)
    parser.add_argument("--service-outage", type=int, default=15, help="Segundos con backend y luego PostgreSQL detenidos")
    parser.add_argument("--output", type=Path, required=True, help="Archivo JSON nuevo con los resultados")
    args = parser.parse_args()
    if args.output.exists():
        raise SystemExit(f"{args.output} ya existe")

    password = env_value("VIGIA_DB_PASSWORD")
    token = setup(f"postgresql+psycopg://vigia:{password}@127.0.0.1:5432/{DATABASE}")
    wait_backend_healthy()
    proxy = FaultProxy(BACKEND_PORT)
    phase = ["base"]
    outbox = Path(tempfile.mkdtemp(prefix="vigia-outbox-"))
    url = f"http://127.0.0.1:{proxy.port}"
    nodes = [SimulatedNode(outbox, url, token, phase)]
    nodes[0].start()
    started = time.monotonic()
    samples, timeline, drains = [], [], {}
    stop_sampling = threading.Event()

    def sample():
        while not stop_sampling.wait(1):
            samples.append({"t": round(time.monotonic() - started, 1), "phase": phase[0],
                            "outbox": sum(1 for _ in outbox.glob("*.json"))})

    threading.Thread(target=sample, daemon=True).start()

    def mark(name):
        timeline.append({"t": round(time.monotonic() - started, 1), "event": name})
        print(f"[{timeline[-1]['t']:>7.1f}s] {name}", flush=True)

    def drain(label, timeout=600):
        """Seconds until every event generated before now has left the outbox."""
        pending = {g.event_id for node in nodes for g in node.generated}
        t0 = time.monotonic()
        while time.monotonic() - t0 < timeout:
            left = {p.stem.split("-", 1)[1] for p in outbox.glob("*.json")}
            if not pending & left:
                drains[label] = round(time.monotonic() - t0, 1)
                mark(f"cola drenada tras {label}: {drains[label]} s")
                return
            time.sleep(0.5)
        raise RuntimeError(f"La cola no drenó tras {label}")

    mark("fase base")
    time.sleep(args.baseline)

    phase[0] = "corte"
    proxy.mode = "blackhole"
    mark(f"corte de red de {args.outage} s")
    time.sleep(args.outage / 2)
    nodes[-1].stop()
    mark(f"nodo reiniciado con {sum(1 for _ in outbox.glob('*.json'))} eventos en cola")
    nodes.append(SimulatedNode(outbox, url, token, phase))
    nodes[-1].start()
    time.sleep(args.outage / 2)
    depth_at_restore = sum(1 for _ in outbox.glob("*.json"))
    phase[0] = "recuperacion"
    proxy.mode = "pass"
    mark(f"red restablecida con {depth_at_restore} eventos en cola")
    drain("corte de red")

    phase[0] = "acuses-perdidos"
    proxy.mode = "drop-response"
    mark(f"acuses perdidos durante {args.lost_ack} s")
    time.sleep(args.lost_ack)
    proxy.mode = "pass"
    phase[0] = "recuperacion"
    mark("acuses restablecidos")
    drain("acuses perdidos")

    for service, label in (("backend-resilience", "backend"), ("db", "PostgreSQL")):
        phase[0] = f"caida-{label.lower()}"
        mark(f"{label} detenido durante {args.service_outage} s")
        compose("stop", service)
        time.sleep(args.service_outage)
        compose("start", service)
        wait_backend_healthy()
        phase[0] = "recuperacion"
        mark(f"{label} de nuevo en marcha")
        drain(f"caída de {label}")

    phase[0] = "final"
    time.sleep(10)
    nodes[-1].stop()
    nodes[-1].publisher.start()  # Deliver what the last ticks left behind, then stop for good.
    drain("cierre")
    nodes[-1].publisher.stop()
    stop_sampling.set()
    mark("fin")

    # ------------------------------------------------------------------ verificación en la base
    import psycopg
    generated = [g for node in nodes for g in node.generated]
    sessions = [node.session_id for node in nodes]
    with psycopg.connect(f"postgresql://vigia:{password}@127.0.0.1:5432/{DATABASE}") as conn:
        rows = conn.execute(
            "SELECT e.event_id::text, e.generated_at, e.received_at FROM ingested_events e "
            "WHERE e.session_id = ANY(%s::uuid[])", (sessions,)).fetchall()
        observations = conn.execute(
            "SELECT count(*), count(DISTINCT (session_id, track_id, first_seen)) FROM edge_observations "
            "WHERE session_id = ANY(%s::uuid[])", (sessions,)).fetchone()
    stored = {r[0]: (r[1], r[2]) for r in rows}
    generated_ids = {g.event_id for g in generated}
    expected_tracks = sum(len(node.tracks_seen) for node in nodes)
    latency = {g.phase: [] for g in generated}
    for g in generated:
        if g.event_id in stored:
            created, received = stored[g.event_id]
            latency[g.phase].append((received - created).total_seconds())
    rejected = sum(1 for _ in (outbox / "rejected").glob("*.json")) if (outbox / "rejected").exists() else 0
    results = {
        "run_at": utc_iso(), "outage_seconds": args.outage, "snapshot_interval_s": 2.0, "publish_timeout_s": 10,
        "events": {"generated": len(generated), "stored": len(rows), "stored_unique": len(stored),
                   "missing": len(generated_ids - stored.keys()), "unexpected": len(stored.keys() - generated_ids),
                   "rejected_by_node": rejected},
        "detections": {"expected_tracks": expected_tracks, "observations": observations[0], "unique_observations": observations[1]},
        "queue": {"max_depth": max(s["outbox"] for s in samples), "depth_at_restore": depth_at_restore},
        "drain_seconds": drains,
        "latency_seconds": {phase_name: {"n": len(v), "p50": percentile(v, .5), "p95": percentile(v, .95), "max": round(max(v), 3) if v else None}
                            for phase_name, v in latency.items()},
        "publisher_retries": sum(node.publisher.status()["retries"] for node in nodes),
        "proxy": proxy.stats, "sessions": len(sessions), "timeline": timeline, "samples": samples,
    }
    ok = (results["events"]["missing"] == 0 and results["events"]["unexpected"] == 0 and rejected == 0
          and len(rows) == len(stored) and observations[0] == observations[1] == expected_tracks)
    results["verdict"] = "aprobado" if ok else "fallido"
    with open(args.output, "x", encoding="utf-8") as target:
        json.dump(results, target, ensure_ascii=False, indent=2, default=str)
    print(json.dumps({k: v for k, v in results.items() if k not in ("samples", "timeline")}, ensure_ascii=False, indent=2, default=str))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
