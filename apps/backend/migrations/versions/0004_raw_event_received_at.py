"""Index raw events by arrival time so retention can delete them without a full scan."""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = depends_on = None


def upgrade():
    op.create_index(op.f("ix_ingested_events_received_at"), "ingested_events", ["received_at"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_ingested_events_received_at"), table_name="ingested_events")
