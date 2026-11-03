"""Placa por detección (7 días, solo admin) y confirmaciones de recortes por consulta."""
import sqlalchemy as sa
from alembic import op

revision = "0006"
down_revision = "0005"
branch_labels = depends_on = None


def upgrade():
    op.add_column("detections", sa.Column("license_plate", sa.String(length=8), nullable=True))
    op.create_index(op.f("ix_detections_license_plate"), "detections", ["license_plate"], unique=False)
    op.add_column("queries", sa.Column("license_plate", sa.String(length=8), nullable=True))
    op.create_table(
        "detection_confirmations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("query_id", sa.Uuid(), nullable=False),
        sa.Column("detection_id", sa.Uuid(), nullable=False),
        sa.Column("verdict", sa.String(length=16), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["query_id"], ["queries.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["detection_id"], ["detections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("query_id", "detection_id", name="uq_confirmation_query_detection"),
    )
    op.create_index(op.f("ix_detection_confirmations_query_id"), "detection_confirmations", ["query_id"], unique=False)


def downgrade():
    op.drop_index(op.f("ix_detection_confirmations_query_id"), table_name="detection_confirmations")
    op.drop_table("detection_confirmations")
    op.drop_column("queries", "license_plate")
    op.drop_index(op.f("ix_detections_license_plate"), table_name="detections")
    op.drop_column("detections", "license_plate")
