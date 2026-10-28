"""Index detections by creation time so thumbnail retention finds expired keys without a full scan."""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = depends_on = None


def upgrade():
    op.create_index(op.f("ix_detections_created_at"), "detections", ["created_at"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_detections_created_at"), table_name="detections")
