"""Encrypted message envelopes: validation, storage and sync."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import Conflict, Forbidden, InvalidInput, PayloadTooLarge
from app.models import Message, PublicKey
from app.schemas import MessageIn
from app.services import contact_service, key_service


def send(db: Session, sender_id: uuid.UUID, data: MessageIn) -> Message:
    if len(data.ciphertext) > settings.max_ciphertext_bytes:
        raise PayloadTooLarge("Message too large")
    if data.recipient_id == sender_id:
        raise InvalidInput("You cannot message yourself")

    # The sender must use their *current* key, and the recipient key must belong to the recipient,
    # so stale or foreign keys can never be referenced.
    if key_service.current_key_id(db, sender_id) != data.sender_key_id:
        raise Conflict("Your encryption key changed. Reload and try again.")
    recipient_key = db.get(PublicKey, data.recipient_key_id)
    if recipient_key is None or recipient_key.user_id != data.recipient_id:
        raise Conflict("Recipient key is not current. Reload and try again.")
    if contact_service.is_blocked(db, blocker_id=data.recipient_id, blocked_id=sender_id):
        raise Forbidden("Message could not be delivered")

    now = datetime.now(timezone.utc)
    retention = timedelta(days=settings.max_message_retention_days)
    lifetime = min(timedelta(seconds=data.ttl_seconds), retention) if data.ttl_seconds else retention

    message = Message(
        id=data.id, sender_id=sender_id, recipient_id=data.recipient_id,
        sender_key_id=data.sender_key_id, recipient_key_id=data.recipient_key_id,
        iv=data.iv, ciphertext=data.ciphertext, ttl_seconds=data.ttl_seconds, expires_at=now + lifetime,
    )
    db.add(message)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("Duplicate message id") from exc
    db.refresh(message)  # load server-generated seq / created_at
    return message


def sync(db: Session, user_id: uuid.UUID, after: int, limit: int) -> tuple[list[Message], bool]:
    """Envelopes sent or received by the user with seq > after, oldest first."""
    rows = list(db.scalars(
        select(Message)
        .where(
            or_(Message.sender_id == user_id, Message.recipient_id == user_id),
            Message.seq > after,
            Message.expires_at > datetime.now(timezone.utc),
        )
        .order_by(Message.seq)
        .limit(limit + 1)
    ))
    return rows[:limit], len(rows) > limit


def delete_expired(db: Session) -> int:
    result = db.execute(delete(Message).where(Message.expires_at < datetime.now(timezone.utc)))
    return result.rowcount or 0
