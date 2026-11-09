"""Periodic housekeeping: disappearing timers, retention, sessions, codes and stale sign-ups."""

from app.core.database import SessionLocal
from app.services import auth_service, message_service, otp_service, session_service


def cleanup_expired() -> None:
    with SessionLocal() as db:
        session_service.delete_expired(db)
        message_service.delete_expired(db)
        otp_service.delete_expired(db)
        auth_service.delete_stale_unverified(db)
        db.commit()
