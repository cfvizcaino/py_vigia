"""Esquemas Pydantic de entrada/salida para la API HTTP."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

# Valores alineados con packages/contracts/detection-snapshot.schema.json
VehicleType = Literal["car", "motorcycle"]
DeviceKind = Literal["physical", "simulated"]
DeviceStatus = Literal["online", "offline", "simulated"]
Direction = Literal[
    "izquierda-a-derecha",
    "derecha-a-izquierda",
    "arriba-a-abajo",
    "abajo-a-arriba",
    "indeterminada",
]


class DeviceCreate(BaseModel):
    """Payload para registrar una cámara."""

    external_id: str = Field(min_length=1, max_length=64)
    name: str = Field(min_length=1, max_length=200)
    kind: DeviceKind
    status: DeviceStatus
    lat: float
    lng: float
    camera_model: str | None = None


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    kind: DeviceKind | None = None
    status: DeviceStatus | None = None
    lat: float | None = None
    lng: float | None = None
    camera_model: str | None = None


class DeviceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    external_id: str
    name: str
    kind: str
    status: str
    lat: float
    lng: float
    camera_model: str | None
    created_at: datetime


class DetectionCreate(BaseModel):
    """Payload para registrar una detección; thumbnail_url es opcional."""

    device_id: uuid.UUID
    track_id: int | None = None
    vehicle_type: VehicleType
    color: str | None = None
    direction: Direction
    confidence: float = Field(gt=0, le=1)
    observed_at: datetime
    thumbnail_url: str | None = None


class DetectionUpdate(BaseModel):
    track_id: int | None = None
    vehicle_type: VehicleType | None = None
    color: str | None = None
    direction: Direction | None = None
    confidence: float | None = Field(default=None, gt=0, le=1)
    observed_at: datetime | None = None
    thumbnail_url: str | None = None


class DetectionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    device_id: uuid.UUID
    track_id: int | None
    vehicle_type: str
    color: str | None
    direction: str
    confidence: float
    observed_at: datetime
    thumbnail_url: str | None
    created_at: datetime
