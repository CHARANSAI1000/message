"""Encrypted message envelopes: validation, storage and sync."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import Conflict, Forbidden, InvalidInput, NotFound, PayloadTooLarge
from app.models import Attachment, Message, PublicKey, message_rev_seq
from app.schemas import MessageEdit, MessageIn
from app.services import attachment_service, contact_service, key_service


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
    if data.attachment_id and not attachment_service.owned_by(db, data.attachment_id, sender_id):
        raise InvalidInput("Attachment not found")

    now = datetime.now(timezone.utc)
    retention = timedelta(days=settings.max_message_retention_days)
    lifetime = min(timedelta(seconds=data.ttl_seconds), retention) if data.ttl_seconds else retention

    message = Message(
        id=data.id, sender_id=sender_id, recipient_id=data.recipient_id,
        sender_key_id=data.sender_key_id, recipient_key_id=data.recipient_key_id,
        iv=data.iv, ciphertext=data.ciphertext, ttl_seconds=data.ttl_seconds, expires_at=now + lifetime,
        attachment_id=data.attachment_id,
    )
    db.add(message)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("Duplicate message id") from exc
    db.refresh(message)  # load server-generated seq / created_at
    return message


def _own_message(db: Session, sender_id: uuid.UUID, message_id: uuid.UUID) -> Message:
    message = db.scalar(select(Message).where(Message.id == message_id, Message.sender_id == sender_id))
    if message is None:
        raise NotFound("Message not found")
    if message.deleted:
        raise Conflict("This message was deleted")
    return message


def edit(db: Session, sender_id: uuid.UUID, message_id: uuid.UUID, data: MessageEdit) -> Message:
    """Replace the ciphertext (re-encrypted by the sender with the same keys) within the edit window."""
    message = _own_message(db, sender_id, message_id)
    if datetime.now(timezone.utc) - message.created_at > timedelta(minutes=settings.message_edit_minutes):
        raise Forbidden(f"Messages can only be edited for {settings.message_edit_minutes} minutes")
    if len(data.ciphertext) > settings.max_ciphertext_bytes:
        raise PayloadTooLarge("Message too large")
    db.execute(update(Message).where(Message.seq == message.seq).values(
        iv=data.iv, ciphertext=data.ciphertext, edited_at=datetime.now(timezone.utc), rev=message_rev_seq.next_value(),
    ))
    db.commit()
    db.refresh(message)
    return message


def delete_for_everyone(db: Session, sender_id: uuid.UUID, message_id: uuid.UUID) -> Message:
    """Wipe the ciphertext and attachment; keep a tombstone so every device shows "message deleted"."""
    message = _own_message(db, sender_id, message_id)
    attachment_id = message.attachment_id
    db.execute(update(Message).where(Message.seq == message.seq).values(
        ciphertext=b"", attachment_id=None, deleted_at=datetime.now(timezone.utc), rev=message_rev_seq.next_value(),
    ))
    if attachment_id:
        db.execute(delete(Attachment).where(Attachment.id == attachment_id))
    db.commit()
    db.refresh(message)
    return message


def sync(db: Session, user_id: uuid.UUID, after: int, limit: int) -> tuple[list[Message], bool]:
    """New, edited and deleted envelopes for the user with rev > after (the client's cursor)."""
    rows = list(db.scalars(
        select(Message)
        .where(
            or_(Message.sender_id == user_id, Message.recipient_id == user_id),
            Message.rev > after,
            Message.expires_at > datetime.now(timezone.utc),
        )
        .order_by(Message.rev)
        .limit(limit + 1)
    ))
    return rows[:limit], len(rows) > limit


def delete_expired(db: Session) -> int:
    result = db.execute(delete(Message).where(Message.expires_at < datetime.now(timezone.utc)))
    return result.rowcount or 0
