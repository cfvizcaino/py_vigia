from pathlib import Path
import sqlite3

from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
import pytest
from sqlalchemy import create_engine, inspect, text

from vigia_backend.db import Base
from vigia_backend import models  # noqa: F401
from vigia_backend.migrate import adopt_legacy, configuration, require_current, upgrade

def legacy_engine(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'legacy.db'}")
    with engine.begin() as connection:
        command.upgrade(configuration(connection), "0001")
        connection.execute(text("DROP TABLE alembic_version"))
        connection.execute(text("INSERT INTO users (id, email, display_name, role, created_at) VALUES ('12345678123456781234567812345678', 'keep@example.org', 'Keep', 'operator', '2026-09-30')"))
    return engine

def test_fresh_upgrade_matches_models_and_is_idempotent(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'fresh.db'}")
    upgrade(engine)
    upgrade(engine)
    require_current(engine)
    with engine.connect() as connection:
        assert compare_metadata(MigrationContext.configure(connection), Base.metadata) == []

def test_startup_requires_migration_without_creating_tables():
    engine = create_engine("sqlite://")
    with pytest.raises(RuntimeError, match="Esquema pendiente"):
        require_current(engine)
    assert inspect(engine).get_table_names() == []

def test_legacy_requires_explicit_adoption_and_preserves_rows(tmp_path):
    engine = legacy_engine(tmp_path)
    with pytest.raises(ValueError, match="sin versión"):
        upgrade(engine)
    backup = tmp_path / "backup.db"
    adopt_legacy(engine, backup)
    require_current(engine)
    assert backup.stat().st_mode & 0o777 == 0o600
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT email FROM users")) == "keep@example.org"
    with sqlite3.connect(backup) as connection:
        assert connection.execute("SELECT email FROM users").fetchone()[0] == "keep@example.org"
        assert "road_options" not in [r[1] for r in connection.execute("PRAGMA table_info(device_links)")]

def test_adopts_pre_credentials_schema(tmp_path):
    engine = legacy_engine(tmp_path)
    with engine.begin() as connection:
        connection.execute(text("DROP TABLE device_credentials"))
        connection.execute(text("DROP TABLE security_audit"))
    adopt_legacy(engine, tmp_path / "backup.db")
    require_current(engine)
    assert "device_credentials" in inspect(engine).get_table_names()

def test_refuses_unknown_drift_and_does_not_stamp(tmp_path):
    engine = legacy_engine(tmp_path)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE users ADD COLUMN unexpected TEXT"))
    with pytest.raises(ValueError, match="difiere"):
        adopt_legacy(engine, tmp_path / "backup.db")
    assert "alembic_version" not in inspect(engine).get_table_names()
    assert not (tmp_path / "backup.db").exists()

def test_backup_never_overwrites(tmp_path):
    engine = legacy_engine(tmp_path)
    backup = tmp_path / "existing.db"
    backup.touch()
    with pytest.raises(FileExistsError):
        adopt_legacy(engine, backup)
    assert "alembic_version" not in inspect(engine).get_table_names()

def test_road_revision_downgrade_upgrade_preserves_legacy_data(tmp_path):
    engine = legacy_engine(tmp_path)
    adopt_legacy(engine, tmp_path / "backup.db")
    with engine.begin() as connection:
        command.downgrade(configuration(connection), "0001")
        assert connection.scalar(text("SELECT email FROM users")) == "keep@example.org"
    upgrade(engine)
    require_current(engine)

def test_auth_revision_keeps_existing_users_without_login(tmp_path):
    engine = legacy_engine(tmp_path)
    adopt_legacy(engine, tmp_path / "backup.db")
    with engine.connect() as connection:
        row = connection.execute(text("SELECT password_hash, is_active FROM users")).one()
    assert row == (None, 1)  # Kept active, but cannot log in until a password is set by CLI.
    with engine.begin() as connection:
        command.downgrade(configuration(connection), "0002")
        assert "user_sessions" not in inspect(connection).get_table_names()
        assert connection.scalar(text("SELECT email FROM users")) == "keep@example.org"
    upgrade(engine)
    require_current(engine)
