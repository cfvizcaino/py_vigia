from alembic import context
from vigia_backend.db import Base, engine
from vigia_backend import models  # noqa: F401

def run(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()

if context.is_offline_mode():
    raise RuntimeError("Use migraciones online contra una base explícita y respaldada")
elif context.config.attributes.get("connection") is not None:
    run(context.config.attributes["connection"])
else:
    with engine.connect() as connection:
        run(connection)
