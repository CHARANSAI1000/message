"""read receipts, presence, privacy settings, contact discovery, native push tokens

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-10
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("read_at", sa.DateTime(timezone=True), nullable=True))
    # Existing messages count as delivered (they were already synced before receipts existed).
    op.execute("UPDATE messages SET delivered_at = created_at")

    op.add_column("users", sa.Column("show_presence", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("users", sa.Column("read_receipts", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("users", sa.Column("discoverable", sa.Boolean(), server_default=sa.true(), nullable=False))
    op.add_column("users", sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("users", sa.Column("email_hash", sa.LargeBinary(), nullable=True))
    op.execute("UPDATE users SET email_hash = sha256(convert_to(email, 'UTF8')) WHERE email IS NOT NULL")
    op.create_index(op.f("ix_users_email_hash"), "users", ["email_hash"])

    op.create_table(
        "device_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.Text(), nullable=False),
        sa.Column("platform", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.CheckConstraint("platform IN ('android', 'ios')", name=op.f("ck_device_tokens_platform_valid")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_device_tokens_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_device_tokens")),
        sa.UniqueConstraint("token", name=op.f("uq_device_tokens_token")),
    )
    op.create_index(op.f("ix_device_tokens_user_id"), "device_tokens", ["user_id"])


def downgrade() -> None:
    op.drop_index(op.f("ix_device_tokens_user_id"), table_name="device_tokens")
    op.drop_table("device_tokens")
    op.drop_index(op.f("ix_users_email_hash"), table_name="users")
    for col in ("email_hash", "last_seen_at", "discoverable", "read_receipts", "show_presence"):
        op.drop_column("users", col)
    op.drop_column("messages", "read_at")
    op.drop_column("messages", "delivered_at")
