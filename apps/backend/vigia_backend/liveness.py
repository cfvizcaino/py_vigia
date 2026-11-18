"""Estado real de cada nodo: activo, en segundo plano, detenido o sin señal.

Antes, un nodo pasaba a `online` con su primer sobre y nunca volvía a `offline`, así que la
consola no distinguía un teléfono detectando de uno al que le cerraron la app. Ahora el
estado se calcula al leer, con dos fuentes:

- El **latido** (`POST /api/v1/ingest/heartbeat`): el nodo lo envía cada 30 s mientras
  detecta, y una vez al pasar a segundo plano (`paused`) o al detener el edge (`stopped`).
- El último **sobre** aceptado, para los nodos de versiones anteriores que no envían latido.

Si el último latido dice `running` y pasan más de 90 s sin otro, el nodo dejó de responder
sin avisar: cerraron la app a la fuerza, se quedó sin red o sin batería.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

from .models import Device, utc_now

HEARTBEAT_INTERVAL_SECONDS = 30
# Three missed heartbeats.
ALIVE_WINDOW = timedelta(seconds=90)
# Nodes without heartbeats only publish when vehicles pass: allow quiet streets.
EVENT_ONLY_WINDOW = timedelta(minutes=10)

ActivityState = Literal["active", "background", "stopped", "no_signal", "never", "simulated"]


def _aware(value: datetime | None) -> datetime | None:
    """SQLite returns naive datetimes; every stored time is UTC."""
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=timezone.utc)


def activity_state(device: Device, now: datetime | None = None) -> ActivityState:
    if device.kind != "physical":
        return "simulated"
    now = now or utc_now()
    heartbeat = _aware(device.last_heartbeat_at)
    event = _aware(device.last_event_at)
    if heartbeat is None and event is None:
        return "never"
    if heartbeat is not None and (event is None or heartbeat >= event - ALIVE_WINDOW):
        # The node speaks the heartbeat protocol: trust what it reported last.
        if device.runtime_state == "stopped":
            return "stopped"
        if device.runtime_state == "paused":
            return "background"
        return "active" if now - heartbeat <= ALIVE_WINDOW else "no_signal"
    assert event is not None
    return "active" if now - event <= EVENT_ONLY_WINDOW else "no_signal"


def last_contact(device: Device) -> datetime | None:
    times = [t for t in (_aware(device.last_heartbeat_at), _aware(device.last_event_at)) if t is not None]
    return max(times) if times else None


def effective_status(device: Device, now: datetime | None = None) -> str:
    """`online`/`offline` for physical nodes from their activity; simulated keep their stored status."""
    if device.kind != "physical":
        return device.status
    return "online" if activity_state(device, now) == "active" else "offline"


_REPORTED = ("analyses_per_second", "active_tracks", "pending_events", "delivered_events", "last_error", "battery")


def device_read(device: Device, now: datetime | None = None):
    """DeviceRead with the derived status and activity."""
    from .schemas import DeviceActivity, DeviceRead

    info = device.runtime_info or {}
    activity = DeviceActivity(
        state=activity_state(device, now),
        last_contact_at=last_contact(device),
        last_heartbeat_at=_aware(device.last_heartbeat_at),
        last_event_at=_aware(device.last_event_at),
        node_version=device.node_version,
        **{key: info.get(key) for key in _REPORTED},
    )
    read = DeviceRead.model_validate(device)
    return read.model_copy(update={"status": effective_status(device, now), "activity": activity})
