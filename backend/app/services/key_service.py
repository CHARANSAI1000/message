"""Public identity keys."""

import uuid

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFound
from app.models import PublicKey


def upload(db: Session, user_id: uuid.UUID, spki: bytes) -> PublicKey:
    key = PublicKey(user_id=user_id, spki=spki)
    db.add(key)
    db.commit()
    return key


def get(db: Session, key_id: int) -> PublicKey:
    key = db.get(PublicKey, key_id)
    if key is None:
        raise NotFound("Key not found")
    return key


def current_key_id(db: Session, user_id: uuid.UUID) -> int | None:
    return db.scalar(select(func.max(PublicKey.id)).where(PublicKey.user_id == user_id))


def latest_keys_subquery():
    """(user_id, key_id) of each user's newest key, for joining onto users."""
    return (
        select(PublicKey.user_id, func.max(PublicKey.id).label("key_id"))
        .group_by(PublicKey.user_id)
        .subquery()
    )
