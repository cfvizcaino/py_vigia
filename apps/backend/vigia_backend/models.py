"""Modelos SQLAlchemy alineados con docs/architecture/data-model.md."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import JSON

from .db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    """Persona que opera (`operator`) o administra (`admin`); sin hash no puede iniciar sesión."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False, default="operator")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default=true())

    queries: Mapped[list["Query"]] = relationship(back_populates="user")


class Device(Base):
    """Cámara física o simulada; la ubicación de una detección es la del dispositivo."""

    __tablename__ = "devices"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    external_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)  # p. ej. CAM-01
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    camera_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    detections: Mapped[list["Detection"]] = relationship(
        back_populates="device", cascade="all, delete-orphan"
    )


class DeviceCredential(Base):
    """Token aleatorio por cámara; nunca se persiste el secreto en texto plano."""

    __tablename__ = "device_credentials"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class SecurityAudit(Base):
    """Auditoría de credenciales y uso (consultas, exportaciones, previews); sin secretos ni imágenes."""

    __tablename__ = "security_audit"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    action: Mapped[str] = mapped_column(String(64), nullable=False)
    camera_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    credential_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True)
    outcome: Mapped[str] = mapped_column(String(32), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, index=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(Uuid(as_uuid=True), nullable=True, index=True)
    detail: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class UserSession(Base):
    """Sesión revocable de una persona; solo se guarda el hash del token portador."""

    __tablename__ = "user_sessions"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class DeviceLink(Base):
    """Distancia por red vial entre cámaras (no Haversine); usada por el algoritmo de rutas."""

    __tablename__ = "device_links"
    __table_args__ = (UniqueConstraint("from_device_id", "to_device_id", name="uq_device_link_pair"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    from_device_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False)
    to_device_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("devices.id"), nullable=False)
    road_distance_m: Mapped[float] = mapped_column(Float, nullable=False)
    road_options: Mapped[list | None] = mapped_column(JSON, nullable=True)
    road_source: Mapped[str | None] = mapped_column(String(32), nullable=True)
    road_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Detection(Base):
    """Observación vehicular central; sin placa/marca/modelo en este prototipo."""

    __tablename__ = "detections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vehicle_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    color: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    direction: Mapped[str] = mapped_column(String(64), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    observed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    thumbnail_url: Mapped[str | None] = mapped_column(Text, nullable=True)  # opcional: aún no se decide si habrá imágenes
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    device: Mapped[Device] = relationship(back_populates="detections")


class IngestedEvent(Base):
    """Sobre edge recibido; event_id y secuencia hacen seguro el reintento."""

    __tablename__ = "ingested_events"
    __table_args__ = (
        UniqueConstraint("device_id", "session_id", "sequence_number", name="uq_ingest_sequence"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), unique=True, nullable=False, index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    sequence_number: Mapped[int] = mapped_column(Integer, nullable=False)
    schema_version: Mapped[str] = mapped_column(String(16), nullable=False)
    node_version: Mapped[str] = mapped_column(String(64), nullable=False)
    model_name: Mapped[str] = mapped_column(String(200), nullable=False)
    model_version: Mapped[str] = mapped_column(String(120), nullable=False)
    model_digest: Mapped[str | None] = mapped_column(String(200), nullable=True)
    frame_number: Mapped[int] = mapped_column(Integer, nullable=False)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    detection_count: Mapped[int] = mapped_column(Integer, nullable=False)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)


class EdgeObservation(Base):
    """Vincula un track edge estable con una única detección central actualizable."""

    __tablename__ = "edge_observations"
    __table_args__ = (
        UniqueConstraint(
            "device_id",
            "session_id",
            "track_id",
            "first_seen",
            name="uq_edge_observation",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    device_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("devices.id", ondelete="CASCADE"), nullable=False, index=True
    )
    detection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("detections.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    session_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    track_id: Mapped[int] = mapped_column(Integer, nullable=False)
    first_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    first_event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)
    last_event_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), nullable=False)


class Query(Base):
    """Historial de una búsqueda autorizada (ubicación, ventana temporal y filtros)."""

    __tablename__ = "queries"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("users.id"), nullable=False)
    lat: Mapped[float] = mapped_column(Float, nullable=False)
    lng: Mapped[float] = mapped_column(Float, nullable=False)
    radius_m: Mapped[float] = mapped_column(Float, nullable=False)
    time_from: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    time_to: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    vehicle_type: Mapped[str | None] = mapped_column(String(32), nullable=True)
    color: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    user: Mapped[User] = relationship(back_populates="queries")
    route_results: Mapped[list["RouteResult"]] = relationship(back_populates="query")


class RouteResult(Base):
    """Una ruta candidata; una consulta puede producir varias (nunca una sola certeza)."""

    __tablename__ = "route_results"

    id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=new_uuid)
    query_id: Mapped[uuid.UUID] = mapped_column(Uuid(as_uuid=True), ForeignKey("queries.id"), nullable=False, index=True)
    rank: Mapped[int] = mapped_column(Integer, nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False)
    has_distant_gaps: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    summary: Mapped[dict | list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)

    query: Mapped[Query] = relationship(back_populates="route_results")
    detections: Mapped[list["RouteResultDetection"]] = relationship(back_populates="route_result")


class RouteResultDetection(Base):
    """Orden de detecciones dentro de una ruta candidata."""

    __tablename__ = "route_result_detections"

    route_result_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("route_results.id"), primary_key=True
    )
    detection_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True), ForeignKey("detections.id"), primary_key=True
    )
    sequence_order: Mapped[int] = mapped_column(Integer, nullable=False)

    route_result: Mapped[RouteResult] = relationship(back_populates="detections")
    detection: Mapped[Detection] = relationship()
