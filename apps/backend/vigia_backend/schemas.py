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


class EdgeDetection(BaseModel):
    """Detección incluida dentro del Detection Envelope 1.1."""

    model_config = ConfigDict(populate_by_name=True)

    track_id: int = Field(alias="trackId", ge=0)
    vehicle_type: VehicleType = Field(alias="vehicleType")
    confidence: float = Field(ge=0, le=1)
    first_seen: datetime = Field(alias="firstSeen")
    last_seen: datetime = Field(alias="lastSeen")
    direction: Direction
    bounding_box: tuple[int, int, int, int] = Field(alias="boundingBox")
    color: str | None
    make: str | None
    model: str | None
    license_plate: str | None = Field(alias="licensePlate")


class DetectionEnvelopeV11(BaseModel):
    """Contrato de publicación edge→centro; aliases conservan el JSON portable."""

    model_config = ConfigDict(populate_by_name=True)

    schema_version: Literal["1.1"] = Field(alias="schemaVersion")
    event_id: uuid.UUID = Field(alias="eventId")
    session_id: uuid.UUID = Field(alias="sessionId")
    sequence_number: int = Field(alias="sequenceNumber", ge=0)
    camera_id: str = Field(alias="cameraId", min_length=1, max_length=64)
    generated_at: datetime = Field(alias="generatedAt")
    node_version: str = Field(alias="nodeVersion", min_length=1, max_length=64)
    model: str = Field(min_length=1, max_length=200)
    model_version: str = Field(alias="modelVersion", min_length=1, max_length=120)
    model_digest: str | None = Field(default=None, alias="modelDigest", max_length=200)
    frame_number: int = Field(alias="frameNumber", ge=0)
    detections: list[EdgeDetection]


class IngestResponse(BaseModel):
    event_id: uuid.UUID
    status: Literal["accepted", "duplicate"]
    created_detections: int
    updated_detections: int


class NearbyDeviceRead(BaseModel):
    id: uuid.UUID
    external_id: str
    name: str
    lat: float
    lng: float
    distance_m: float


class RouteDetectionHop(BaseModel):
    sequence_order: int
    detection_id: uuid.UUID
    camera_id: str
    vehicle_type: str
    color: str | None
    direction: str
    confidence: float
    observed_at: datetime


class RouteCandidateRead(BaseModel):
    id: uuid.UUID
    rank: int
    confidence: float
    has_distant_gaps: bool
    camera_ids: list[str]
    vehicle_type: str
    color: str | None
    detections: list[RouteDetectionHop]


class QueryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    lat: float
    lng: float
    radius_m: float
    time_from: datetime
    time_to: datetime
    vehicle_type: str | None
    color: str | None
    created_at: datetime


class QueryExecuteResponse(BaseModel):
    """Respuesta de GET /queries: varias rutas candidatas, nunca una sola certeza."""

    query: QueryRead
    nearby_devices: list[NearbyDeviceRead]
    candidate_detection_count: int
    routes: list[RouteCandidateRead]
