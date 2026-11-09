import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, LargeBinary, Sequence, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

# Every insert, edit and delete takes a new revision number; clients sync with `rev > cursor`,
# so edits and deletions reach other devices the same way new messages do.
message_rev_seq = Sequence("message_rev_seq", metadata=Base.metadata)


class Message(Base):
    """An opaque encrypted envelope. The server never sees plaintext."""

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("octet_length(iv) = 12", name="iv_size"),
        Index("ix_messages_recipient_id_seq", "recipient_id", "seq"),
        Index("ix_messages_sender_id_seq", "sender_id", "seq"),
        Index("ix_messages_recipient_id_rev", "recipient_id", "rev"),
        Index("ix_messages_sender_id_rev", "sender_id", "rev"),
    )

    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    rev: Mapped[int] = mapped_column(BigInteger, message_rev_seq, server_default=message_rev_seq.next_value())
    id: Mapped[uuid.UUID] = mapped_column(unique=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    sender_key_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("public_keys.id", ondelete="CASCADE"))
    recipient_key_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("public_keys.id", ondelete="CASCADE"))
    iv: Mapped[bytes] = mapped_column(LargeBinary)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    ttl_seconds: Mapped[int | None]
    # Encrypted attachment (photo, file, voice note) this message carries; its key is inside the ciphertext.
    attachment_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("attachments.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    edited_at: Mapped[datetime | None]
    deleted_at: Mapped[datetime | None]  # "deleted for everyone": ciphertext wiped, tombstone kept
    expires_at: Mapped[datetime] = mapped_column(index=True)

    @property
    def deleted(self) -> bool:
        return self.deleted_at is not None
