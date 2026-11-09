"""Username changes and profile photos."""

import uuid
from datetime import datetime, timezone

from sqlalchemy.exc import IntegrityError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import Conflict, InvalidInput, NotFound, PayloadTooLarge
from app.models import User

# Magic bytes → MIME. Only these image types are accepted (never SVG: it can carry script).
IMAGE_SIGNATURES = {b"\xff\xd8\xff": "image/jpeg", b"\x89PNG\r\n\x1a\n": "image/png"}


def _sniff(data: bytes) -> str | None:
    for magic, mime in IMAGE_SIGNATURES.items():
        if data.startswith(magic):
            return mime
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def change_username(db: Session, user_id: uuid.UUID, username: str) -> User:
    user = db.get_one(User, user_id)
    if user.username == username:
        return user
    user.username = username
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("That username is taken", code="username_taken") from exc
    return user


def set_avatar(db: Session, user_id: uuid.UUID, data: bytes) -> User:
    if len(data) > settings.max_avatar_bytes:
        raise PayloadTooLarge("Profile photo is too large")
    mime = _sniff(data)
    if mime is None:
        raise InvalidInput("Use a JPEG, PNG or WebP image")
    user = db.get_one(User, user_id)
    user.avatar, user.avatar_mime, user.avatar_updated_at = data, mime, datetime.now(timezone.utc)
    db.commit()
    return user


def remove_avatar(db: Session, user_id: uuid.UUID) -> None:
    user = db.get_one(User, user_id)
    user.avatar = user.avatar_mime = user.avatar_updated_at = None
    db.commit()


def get_avatar(db: Session, user_id: uuid.UUID) -> tuple[bytes, str]:
    row = db.execute(select(User.avatar, User.avatar_mime).where(User.id == user_id)).first()
    if row is None or row[0] is None:
        raise NotFound("No profile photo")
    return row[0], row[1]
