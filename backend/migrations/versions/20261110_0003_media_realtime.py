"""media, message edit/delete revisions, avatars, push subscriptions

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-10
"""
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "attachments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("uploader_id", sa.Uuid(), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("content", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["uploader_id"], ["users.id"], name=op.f("fk_attachments_uploader_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_attachments")),
    )
    op.create_index(op.f("ix_attachments_uploader_id"), "attachments", ["uploader_id"])
    op.create_index(op.f("ix_attachments_created_at"), "attachments", ["created_at"])

    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.Text(), nullable=False),
        sa.Column("p256dh", sa.Text(), nullable=False),
        sa.Column("auth", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], name=op.f("fk_push_subscriptions_user_id_users"), ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_push_subscriptions")),
        sa.UniqueConstraint("endpoint", name=op.f("uq_push_subscriptions_endpoint")),
    )
    op.create_index(op.f("ix_push_subscriptions_user_id"), "push_subscriptions", ["user_id"])

    op.add_column("users", sa.Column("avatar", sa.LargeBinary(), nullable=True))
    op.add_column("users", sa.Column("avatar_mime", sa.Text(), nullable=True))
    op.add_column("users", sa.Column("avatar_updated_at", sa.DateTime(timezone=True), nullable=True))

    # Revision numbers: existing rows get rev values in creation order.
    op.execute("CREATE SEQUENCE message_rev_seq")
    op.add_column("messages", sa.Column("rev", sa.BigInteger(), nullable=True))
    op.execute("UPDATE messages SET rev = nextval('message_rev_seq') FROM (SELECT seq FROM messages ORDER BY seq) s WHERE messages.seq = s.seq")
    op.alter_column("messages", "rev", nullable=False, server_default=sa.text("nextval('message_rev_seq'::regclass)"))
    op.add_column("messages", sa.Column("attachment_id", sa.Uuid(), nullable=True))
    op.add_column("messages", sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True))
    op.create_foreign_key(op.f("fk_messages_attachment_id_attachments"), "messages", "attachments",
                          ["attachment_id"], ["id"], ondelete="SET NULL")
    op.create_index(op.f("ix_messages_attachment_id"), "messages", ["attachment_id"])
    op.create_index("ix_messages_recipient_id_rev", "messages", ["recipient_id", "rev"])
    op.create_index("ix_messages_sender_id_rev", "messages", ["sender_id", "rev"])


def downgrade() -> None:
    op.drop_index("ix_messages_sender_id_rev", table_name="messages")
    op.drop_index("ix_messages_recipient_id_rev", table_name="messages")
    op.drop_index(op.f("ix_messages_attachment_id"), table_name="messages")
    op.drop_constraint(op.f("fk_messages_attachment_id_attachments"), "messages", type_="foreignkey")
    for col in ("deleted_at", "edited_at", "attachment_id", "rev"):
        op.drop_column("messages", col)
    op.execute("DROP SEQUENCE message_rev_seq")
    for col in ("avatar_updated_at", "avatar_mime", "avatar"):
        op.drop_column("users", col)
    op.drop_table("push_subscriptions")
    op.drop_table("attachments")
