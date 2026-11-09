import uuid
from datetime import datetime

from sqlalchemy import ForeignKey, LargeBinary, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base


class Attachment(Base):
    """Client-encrypted file bytes. The server stores ciphertext only; the key travels inside the message."""

    __tablename__ = "attachments"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    uploader_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    size: Mapped[int]
    content: Mapped[bytes] = mapped_column(LargeBinary, deferred=True)  # never loaded unless downloaded
    created_at: Mapped[datetime] = mapped_column(server_default=func.now(), index=True)
