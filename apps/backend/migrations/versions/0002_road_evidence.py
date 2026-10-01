"""Directed road alternatives and provenance; legacy links remain unverified."""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = depends_on = None

def upgrade():
    op.add_column("device_links", sa.Column("road_options", sa.JSON(), nullable=True))
    op.add_column("device_links", sa.Column("road_source", sa.String(32), nullable=True))
    op.add_column("device_links", sa.Column("road_updated_at", sa.DateTime(timezone=True), nullable=True))

def downgrade():
    with op.batch_alter_table("device_links") as batch:
        batch.drop_column("road_updated_at")
        batch.drop_column("road_source")
        batch.drop_column("road_options")
