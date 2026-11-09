import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, Text, func
from sqlalchemy.orm import Mapped, mapped_column

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
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    @property
    def email_verified(self) -> bool:
        # Accounts created before email support have no email and are treated as verified.
        return self.email is None or self.email_verified_at is not None
