"""Server-side sessions: create, resolve from cookie token, list and revoke."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.security import hash_token, new_session_token
from app.models import AuthSession, User

TOUCH_INTERVAL = timedelta(minutes=5)


@dataclass(frozen=True)
class CurrentUser:
    id: uuid.UUID
    username: str
    session_id: uuid.UUID


def create(db: Session, user_id: uuid.UUID, user_agent: str) -> str:
    """Add a session to the current transaction and return the raw token for the cookie."""
    token, token_hash = new_session_token()
    db.add(AuthSession(
        user_id=user_id,
        token_hash=token_hash,
        user_agent=user_agent[:200],
        expires_at=datetime.now(timezone.utc) + timedelta(days=settings.session_idle_days),
    ))
    return token


def resolve(db: Session, token: str) -> CurrentUser | None:
    row = db.execute(
        select(AuthSession, User.username)
        .join(User, User.id == AuthSession.user_id)
        .where(AuthSession.token_hash == hash_token(token), AuthSession.expires_at > datetime.now(timezone.utc))
    ).first()
    if row is None:
        return None
    session, username = row
    now = datetime.now(timezone.utc)
    if now - session.last_seen_at > TOUCH_INTERVAL:
        # Sliding idle timeout, capped by the absolute lifetime.
        session.last_seen_at = now
        session.expires_at = min(now + timedelta(days=settings.session_idle_days),
                                 session.created_at + timedelta(days=settings.session_absolute_days))
        db.commit()
    return CurrentUser(id=session.user_id, username=username, session_id=session.id)


def list_active(db: Session, user_id: uuid.UUID) -> list[AuthSession]:
    return list(db.scalars(
        select(AuthSession)
        .where(AuthSession.user_id == user_id, AuthSession.expires_at > datetime.now(timezone.utc))
        .order_by(AuthSession.last_seen_at.desc())
    ))


def revoke(db: Session, user_id: uuid.UUID, session_id: uuid.UUID) -> None:
    db.execute(delete(AuthSession).where(AuthSession.id == session_id, AuthSession.user_id == user_id))
    db.commit()


def revoke_others(db: Session, user_id: uuid.UUID, keep_session_id: uuid.UUID) -> None:
    """Delete every other session of the user (no commit; caller owns the transaction)."""
    db.execute(delete(AuthSession).where(AuthSession.user_id == user_id, AuthSession.id != keep_session_id))


def delete_expired(db: Session) -> int:
    result = db.execute(delete(AuthSession).where(AuthSession.expires_at < datetime.now(timezone.utc)))
    return result.rowcount or 0


