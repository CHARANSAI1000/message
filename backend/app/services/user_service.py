"""User profiles and privacy-preserving lookup."""

import uuid

from sqlalchemy import Select, exists, or_, and_, select
from sqlalchemy.orm import Session

from app.core.exceptions import NotFound
from app.models import Contact, Message, PublicKey, User
from app.services.key_service import latest_keys_subquery

Profile = tuple[User, PublicKey | None]


def profiles_query() -> Select[tuple[User, PublicKey]]:
    """Users joined with their newest public key (or NULL)."""
    latest = latest_keys_subquery()
    return (
        select(User, PublicKey)
        .outerjoin(latest, latest.c.user_id == User.id)
        .outerjoin(PublicKey, PublicKey.id == latest.c.key_id)
    )


def get_by_username(db: Session, username: str) -> Profile:
    """Exact match only: there is deliberately no way to list or search users."""
    row = db.execute(
        profiles_query().where(User.username == username, or_(User.email.is_(None), User.email_verified_at.is_not(None)))
    ).first()
    if row is None:
        raise NotFound("User not found")
    return row[0], row[1]


def get_visible(db: Session, viewer_id: uuid.UUID, target_id: uuid.UUID) -> Profile:
    """Visible to yourself, your contacts, people who added you, and people you have a conversation with."""
    related = or_(
        User.id == viewer_id,
        exists().where(Contact.owner_id == viewer_id, Contact.contact_id == target_id),
        exists().where(Contact.owner_id == target_id, Contact.contact_id == viewer_id),  # they added you
        exists().where(or_(
            and_(Message.sender_id == viewer_id, Message.recipient_id == target_id),
            and_(Message.sender_id == target_id, Message.recipient_id == viewer_id),
        )),
    )
    row = db.execute(profiles_query().where(User.id == target_id, related)).first()
    if row is None:
        raise NotFound("User not found")
    return row[0], row[1]
