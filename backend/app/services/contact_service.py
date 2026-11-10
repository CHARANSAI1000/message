"""Contacts and blocks."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.exceptions import InvalidInput, NotFound
from app.models import Block, Contact, User
from app.services import user_service
from app.services.user_service import Profile


def list_contacts(db: Session, owner_id: uuid.UUID) -> list[Profile]:
    rows = db.execute(
        user_service.profiles_query()
        .join(Contact, Contact.contact_id == User.id)
        .where(Contact.owner_id == owner_id)
        .order_by(User.username)
    ).all()
    return [(r[0], r[1]) for r in rows]


def add_contact(db: Session, owner_id: uuid.UUID, username: str) -> Profile:
    user, key = user_service.get_by_username(db, username)
    if user.id == owner_id:
        raise InvalidInput("You cannot add yourself")
    db.execute(insert(Contact).values(owner_id=owner_id, contact_id=user.id).on_conflict_do_nothing())
    db.commit()
    return user, key


def remove_contact(db: Session, owner_id: uuid.UUID, contact_id: uuid.UUID) -> None:
    db.execute(delete(Contact).where(Contact.owner_id == owner_id, Contact.contact_id == contact_id))
    db.commit()


def list_blocked_ids(db: Session, blocker_id: uuid.UUID) -> list[uuid.UUID]:
    return list(db.scalars(select(Block.blocked_id).where(Block.blocker_id == blocker_id)))


def block(db: Session, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
    if blocked_id == blocker_id:
        raise InvalidInput("You cannot block yourself")
    if db.get(User, blocked_id) is None:
        raise NotFound("User not found")
    db.execute(insert(Block).values(blocker_id=blocker_id, blocked_id=blocked_id).on_conflict_do_nothing())
    db.commit()


def unblock(db: Session, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> None:
    db.execute(delete(Block).where(Block.blocker_id == blocker_id, Block.blocked_id == blocked_id))
    db.commit()


def is_blocked(db: Session, blocker_id: uuid.UUID, blocked_id: uuid.UUID) -> bool:
    return db.get(Block, (blocker_id, blocked_id)) is not None


def discover(db: Session, user_id: uuid.UUID, hashes: list[str]) -> list[Profile]:
    """Match hashed phone-contact emails against discoverable, verified accounts (hashes are not stored)."""
    if not hashes:
        return []
    digests = [bytes.fromhex(h) for h in hashes]
    rows = db.execute(
        user_service.profiles_query().where(
            User.email_hash.in_(digests), User.discoverable.is_(True), User.email_verified_at.is_not(None),
            User.id != user_id,
            ~select(Block.blocker_id).where(Block.blocker_id == User.id, Block.blocked_id == user_id).exists(),
        ).order_by(User.username)
    ).all()
    return [(r[0], r[1]) for r in rows]
