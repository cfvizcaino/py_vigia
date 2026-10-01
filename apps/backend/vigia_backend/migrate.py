"""Migraciones explícitas: upgrade, check y adopción validada del MVP SQLite."""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import sqlite3

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import MetaData, create_engine, inspect

ROOT = Path(__file__).resolve().parent.parent

def configuration(connection=None):
    config = Config(str(ROOT / "alembic.ini"))
    if connection is not None:
        config.attributes["connection"] = connection
    return config

def require_current(engine):
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_heads()
    expected = tuple(ScriptDirectory.from_config(configuration()).get_heads())
    if current != expected:
        raise RuntimeError("Esquema pendiente: ejecuta python -m vigia_backend.migrate upgrade; para MVP existente usa adopt-legacy --backup ARCHIVO_NUEVO")

def upgrade(engine):
    with engine.begin() as connection:
        tables = inspect(connection).get_table_names()
        if tables and "alembic_version" not in tables:
            raise ValueError("Base MVP sin versión: usa adopt-legacy --backup ARCHIVO_NUEVO; no se modificó el esquema")
        command.upgrade(configuration(connection), "head")

def adopt_legacy(engine, backup: Path):
    if engine.dialect.name != "sqlite":
        raise ValueError("La adopción automática solo admite el MVP SQLite")
    # Materialize the frozen baseline, never the evolving application's models.
    reference = create_engine("sqlite://")
    expected = MetaData()
    with reference.begin() as connection:
        command.upgrade(configuration(connection), "0001")
        expected.reflect(connection)
    expected.remove(expected.tables["alembic_version"])
    reference.dispose()
    with engine.connect() as connection:
        existing = set(inspect(connection).get_table_names())
        if "alembic_version" in existing or not existing:
            raise ValueError("La adopción exige una base MVP existente sin versión")
        missing = set(expected.tables) - existing
        if missing - {"device_credentials", "security_audit"}:
            raise ValueError("Faltan tablas del MVP; se requiere revisión manual")
        comparison = MetaData()
        for table in expected.sorted_tables:
            if table.name not in missing:
                table.to_metadata(comparison)
        if compare_metadata(MigrationContext.configure(connection), comparison):
            raise ValueError("El esquema difiere del MVP conocido; no se permite stamp a ciegas")
    descriptor = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    os.close(descriptor)
    raw = engine.raw_connection()
    try:
        with sqlite3.connect(backup) as target:
            raw.driver_connection.backup(target)
    finally:
        raw.close()
    with engine.begin() as connection:
        for table in expected.sorted_tables:
            if table.name in missing:
                table.create(connection)
        command.stamp(configuration(connection), "0001")
    upgrade(engine)

def main():
    from .db import engine
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["upgrade", "check", "adopt-legacy"])
    parser.add_argument("--backup", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "check":
            require_current(engine)
        elif args.action == "upgrade":
            upgrade(engine)
        else:
            if not args.backup:
                raise ValueError("Se requiere --backup con una ruta nueva")
            adopt_legacy(engine, args.backup)
    except (ValueError, RuntimeError, OSError) as exc:
        parser.exit(1, f"Migración no completada: {exc}\n")
    print("Esquema en la revisión vigente")

if __name__ == "__main__":
    main()
