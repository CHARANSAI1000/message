from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, Index, LargeBinary, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base

PURPOSES = ("verify_email", "login", "reset_password", "delete_account")


class EmailCode(Base):
    """A one-time 6-digit code sent by email. Only a salted SHA-256 of the code is stored."""

    __tablename__ = "email_codes"
    __table_args__ = (
        CheckConstraint(f"purpose IN ({', '.join(repr(p) for p in PURPOSES)})", name="purpose_valid"),
        Index("ix_email_codes_email_purpose", "email", "purpose"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(Text)
    purpose: Mapped[str] = mapped_column(Text)
    salt: Mapped[bytes] = mapped_column(LargeBinary)
    code_hash: Mapped[bytes] = mapped_column(LargeBinary)
    attempts: Mapped[int] = mapped_column(default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(index=True)
