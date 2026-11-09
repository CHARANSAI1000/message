import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, LargeBinary, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class PublicKey(Base):
    """A user's ECDH P-256 public key (SPKI). Private keys never leave the browser."""

    __tablename__ = "public_keys"
    __table_args__ = (
        CheckConstraint("octet_length(spki) BETWEEN 64 AND 200", name="spki_size"),
        Index("ix_public_keys_user_id_id", "user_id", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    spki: Mapped[bytes] = mapped_column(LargeBinary)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
