"""Actividad real de los nodos: último sobre, último latido, estado y versión reportados."""
import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = depends_on = None


def upgrade():
    op.add_column("devices", sa.Column("last_event_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("last_heartbeat_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("devices", sa.Column("runtime_state", sa.String(length=16), nullable=True))
    op.add_column("devices", sa.Column("node_version", sa.String(length=64), nullable=True))
    op.add_column("devices", sa.Column("runtime_info", sa.JSON(), nullable=True))
    # Seed the last event from what is already stored, so nodes that are sending today
    # do not show up as "never connected" right after the deploy.
    op.execute(
        "UPDATE devices SET last_event_at = (SELECT MAX(received_at) FROM ingested_events "
        "WHERE ingested_events.device_id = devices.id)"
    )


def downgrade():
    for column in ("runtime_info", "node_version", "runtime_state", "last_heartbeat_at", "last_event_at"):
        op.drop_column("devices", column)
