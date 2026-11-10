import uuid
from datetime import datetime

import hashlib

from sqlalchemy import CheckConstraint, LargeBinary, Text, func, true
from sqlalchemy.orm import Mapped, mapped_column, validates

from app.models.base import Base


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("username ~ '^[a-z0-9_.-]{3,32}$'", name="username_format"),
        CheckConstraint("email IS NULL OR email = lower(email)", name="email_lowercase"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    username: Mapped[str] = mapped_column(Text, unique=True)
    email: Mapped[str | None] = mapped_column(Text, unique=True)
    email_verified_at: Mapped[datetime | None]
    # NULL for accounts that only sign in with Google or email codes.
    password_hash: Mapped[str | None] = mapped_column(Text)
    # Google's stable account id ("sub" claim), set when Sign in with Google is linked.
    google_sub: Mapped[str | None] = mapped_column(Text, unique=True)
    # Profile photo (public to people who can see the profile), resized by the client.
    avatar: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    avatar_mime: Mapped[str | None] = mapped_column(Text)
    avatar_updated_at: Mapped[datetime | None]
    # Privacy (WhatsApp-style, reciprocal): hiding yours also hides other people's from you.
    show_presence: Mapped[bool] = mapped_column(default=True, server_default=true())
    read_receipts: Mapped[bool] = mapped_column(default=True, server_default=true())
    discoverable: Mapped[bool] = mapped_column(default=True, server_default=true())  # findable from phone contacts
    last_seen_at: Mapped[datetime | None]
    # SHA-256 of the lowercased email, used to match phone contacts without sending raw emails.
    email_hash: Mapped[bytes | None] = mapped_column(LargeBinary, index=True)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    @validates("email")
    def _hash_email(self, _key: str, value: str | None) -> str | None:
        self.email_hash = hashlib.sha256(value.encode()).digest() if value else None
        return value

    @property
    def avatar_version(self) -> int | None:
        return int(self.avatar_updated_at.timestamp()) if self.avatar_updated_at else None

    @property
    def email_verified(self) -> bool:
        # Accounts created before email support have no email and are treated as verified.
        return self.email is None or self.email_verified_at is not None
