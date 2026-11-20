"""Borrado lógico de nodos edge: se conservan sus detecciones y se revocan sus tokens."""
import sqlalchemy as sa
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = depends_on = None


def upgrade():
    with op.batch_alter_table("devices") as batch:
        batch.add_column(sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("deleted_by", sa.Uuid(), nullable=True))
        batch.create_foreign_key("fk_devices_deleted_by_users", "users", ["deleted_by"], ["id"])


def downgrade():
    with op.batch_alter_table("devices") as batch:
        batch.drop_constraint("fk_devices_deleted_by_users", type_="foreignkey")
        batch.drop_column("deleted_by")
        batch.drop_column("deleted_at")
