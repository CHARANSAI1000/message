import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, LargeBinary, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Message(Base):
    """An opaque encrypted envelope. The server never sees plaintext."""

    __tablename__ = "messages"
    __table_args__ = (
        CheckConstraint("octet_length(iv) = 12", name="iv_size"),
        Index("ix_messages_recipient_id_seq", "recipient_id", "seq"),
        Index("ix_messages_sender_id_seq", "sender_id", "seq"),
    )

    seq: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    id: Mapped[uuid.UUID] = mapped_column(unique=True)
    sender_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    recipient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    sender_key_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("public_keys.id", ondelete="CASCADE"))
    recipient_key_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("public_keys.id", ondelete="CASCADE"))
    iv: Mapped[bytes] = mapped_column(LargeBinary)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    ttl_seconds: Mapped[int | None]
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(index=True)
