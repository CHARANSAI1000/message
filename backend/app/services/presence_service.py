"""Online / last seen, shown only between people who both share presence and know each other."""

import uuid
from datetime import datetime, timezone

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.core.exceptions import NotFound
from app.models import User
from app.services import contact_service, user_service


def can_see(db: Session, viewer_id: uuid.UUID, target_id: uuid.UUID) -> bool:
    viewer, target = db.get(User, viewer_id), db.get(User, target_id)
    if not viewer or not target or not (viewer.show_presence and target.show_presence):
        return False
    if contact_service.is_blocked(db, target_id, viewer_id) or contact_service.is_blocked(db, viewer_id, target_id):
        return False
    try:
        user_service.get_visible(db, viewer_id, target_id)
    except NotFound:
        return False
    return True


def payload(db: Session, viewer_id: uuid.UUID, target_id: uuid.UUID, online: bool) -> dict:
    if not can_see(db, viewer_id, target_id):
        return {"type": "presence", "user": str(target_id), "hidden": True}
    target = db.get_one(User, target_id)
    last = target.last_seen_at.isoformat() if target.last_seen_at else None
    return {"type": "presence", "user": str(target_id), "online": online, "last_seen": last}


def touch_last_seen(db: Session, user_id: uuid.UUID) -> None:
    db.execute(update(User).where(User.id == user_id).values(last_seen_at=datetime.now(timezone.utc)))
    db.commit()
