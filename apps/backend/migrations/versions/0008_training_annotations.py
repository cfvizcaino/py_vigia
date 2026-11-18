"""Fase 4: etiquetas explícitas de color y placa sobre recortes, para entrenar y evaluar."""
import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "training_annotations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("detection_id", sa.Uuid(), nullable=True),
        sa.Column("task", sa.String(length=16), nullable=False),
        sa.Column("label", sa.String(length=32), nullable=False),
        sa.Column("predicted", sa.String(length=64), nullable=True),
        sa.Column("detection_confidence", sa.Float(), nullable=True),
        sa.Column("model_digest", sa.String(length=200), nullable=True),
        sa.Column("camera_id", sa.String(length=64), nullable=False),
        sa.Column("track_id", sa.Integer(), nullable=True),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("image_sha256", sa.String(length=64), nullable=False),
        sa.Column("sample_key", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["detection_id"], ["detections.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("detection_id", "task", name="uq_annotation_detection_task"),
    )
    for column in ("detection_id", "task", "camera_id", "image_sha256", "created_at"):
        op.create_index(op.f(f"ix_training_annotations_{column}"), "training_annotations", [column], unique=False)


def downgrade():
    for column in ("created_at", "image_sha256", "camera_id", "task", "detection_id"):
        op.drop_index(op.f(f"ix_training_annotations_{column}"), table_name="training_annotations")
    op.drop_table("training_annotations")
