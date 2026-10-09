"""People authentication: password hash, revocable sessions and usage audit."""
from alembic import op
import sqlalchemy as sa

revision = "0003"
down_revision = "0002"
branch_labels = depends_on = None

def upgrade():
    # Existing users (e.g. the seed operator) stay without a hash: they cannot log in until one is set.
    op.add_column("users", sa.Column("password_hash", sa.String(255), nullable=True))
    op.add_column("users", sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()))
    op.add_column("security_audit", sa.Column("user_id", sa.Uuid(), nullable=True))
    op.add_column("security_audit", sa.Column("detail", sa.JSON(), nullable=True))
    op.create_index(op.f("ix_security_audit_user_id"), "security_audit", ["user_id"], unique=False)
    op.create_table(
        "user_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_user_sessions_user_id"), "user_sessions", ["user_id"], unique=False)
    op.create_index(op.f("ix_user_sessions_token_hash"), "user_sessions", ["token_hash"], unique=True)

def downgrade():
    op.drop_index(op.f("ix_user_sessions_token_hash"), table_name="user_sessions")
    op.drop_index(op.f("ix_user_sessions_user_id"), table_name="user_sessions")
    op.drop_table("user_sessions")
    op.drop_index(op.f("ix_security_audit_user_id"), table_name="security_audit")
    with op.batch_alter_table("security_audit") as batch:
        batch.drop_column("detail")
        batch.drop_column("user_id")
    with op.batch_alter_table("users") as batch:
        batch.drop_column("is_active")
        batch.drop_column("password_hash")
