"""Encrypted attachments (photos, files, voice notes). Bytes are ciphertext produced by the client."""

import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, exists, or_, select
from sqlalchemy.orm import Session, undefer

from app.core.config import settings
from app.core.exceptions import InvalidInput, NotFound, PayloadTooLarge
from app.models import Attachment, Message


def upload(db: Session, uploader_id: uuid.UUID, content: bytes) -> Attachment:
    if not content:
        raise InvalidInput("Empty upload")
    if len(content) > settings.max_attachment_bytes:
        raise PayloadTooLarge(f"Files can be up to {settings.max_attachment_bytes // (1024 * 1024)} MB")
    att = Attachment(uploader_id=uploader_id, size=len(content), content=content)
    db.add(att)
    db.commit()
    return att


def download(db: Session, user_id: uuid.UUID, attachment_id: uuid.UUID) -> bytes:
    """Only the uploader and people a (non-deleted) message carrying it was sent to may download."""
    allowed = or_(
        Attachment.uploader_id == user_id,
        exists().where(and_(
            Message.attachment_id == Attachment.id,
            Message.deleted_at.is_(None),
            or_(Message.recipient_id == user_id, Message.sender_id == user_id),
        )),
    )
    att = db.scalar(select(Attachment).options(undefer(Attachment.content)).where(Attachment.id == attachment_id, allowed))
    if att is None:
        raise NotFound("Attachment not found")
    return att.content


def owned_by(db: Session, attachment_id: uuid.UUID, user_id: uuid.UUID) -> bool:
    return db.scalar(select(Attachment.id).where(Attachment.id == attachment_id, Attachment.uploader_id == user_id)) is not None


def delete_orphans(db: Session) -> int:
    """Remove uploads no live message references (abandoned uploads, deleted/expired messages)."""
    cutoff = datetime.now(timezone.utc) - timedelta(hours=1)
    result = db.execute(delete(Attachment).where(
        Attachment.created_at < cutoff,
        ~exists().where(and_(Message.attachment_id == Attachment.id, Message.deleted_at.is_(None))),
    ))
    return result.rowcount or 0
