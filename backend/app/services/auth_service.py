"""Accounts: email/password with verification codes, passwordless email codes, Google, and lifecycle."""

import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import Conflict, Forbidden, InvalidInput, Unauthorized
from app.core.security import hash_password, needs_rehash, verify_password
from app.models import AuthSession, User
from app.services import otp_service, session_service
from app.services.google_service import GoogleIdentity
from app.services.session_service import CurrentUser


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _start(db: Session, user: User, user_agent: str) -> tuple[User, str]:
    token = session_service.create(db, user.id, user_agent)
    db.commit()
    return user, token


def _drop_unverified(db: Session, email: str) -> None:
    """An unverified account never proved it owns the address, so a real owner can reclaim it."""
    db.execute(delete(User).where(User.email == email, User.email_verified_at.is_(None)))


def _by_email(db: Session, email: str) -> User | None:
    return db.scalar(select(User).where(User.email == email))


# ---------------------------------------------------------------- email + password
def register(db: Session, email: str, username: str, password: str) -> str:
    """Create an unverified account and email a verification code. Returns the email."""
    existing = _by_email(db, email)
    if existing is not None and existing.email_verified_at is not None:
        raise Conflict("An account with this email already exists. Sign in instead.", code="email_taken")
    _drop_unverified(db, email)
    db.add(User(username=username, email=email, password_hash=hash_password(password)))
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("That username is taken", code="username_taken") from exc
    db.commit()
    otp_service.issue(db, email, "verify_email")
    return email


def resend_verification(db: Session, email: str) -> None:
    user = _by_email(db, email)
    if user is not None and user.email_verified_at is None:
        otp_service.issue(db, email, "verify_email")


def verify_email(db: Session, email: str, code: str, user_agent: str) -> tuple[User, str]:
    otp_service.verify(db, email, "verify_email", code)
    user = _by_email(db, email)
    if user is None:
        raise InvalidInput("That code is incorrect or has expired. Request a new one.", code="invalid_code")
    user.email_verified_at = user.email_verified_at or _now()
    return _start(db, user, user_agent)


def login(db: Session, identifier: str, password: str, user_agent: str) -> tuple[User, str]:
    column = User.email if "@" in identifier else User.username
    user = db.scalar(select(User).where(column == identifier))
    if not verify_password(user.password_hash if user else None, password):
        raise Unauthorized("Incorrect email/username or password")
    assert user is not None and user.password_hash is not None
    if not user.email_verified:
        otp_service.issue(db, user.email, "verify_email")  # type: ignore[arg-type]
        raise Forbidden("Please verify your email. We've sent you a new code.",
                        code="email_unverified", extra={"email": user.email})
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(password)
    return _start(db, user, user_agent)


# ---------------------------------------------------------------- passwordless email codes
def request_login_code(db: Session, email: str) -> None:
    """Always succeeds from the caller's view, so it never reveals whether an account exists."""
    user = _by_email(db, email)
    if user is not None:
        otp_service.issue(db, email, "login")


def login_with_code(db: Session, email: str, code: str, user_agent: str) -> tuple[User, str]:
    otp_service.verify(db, email, "login", code)
    user = _by_email(db, email)
    if user is None:
        raise InvalidInput("That code is incorrect or has expired. Request a new one.", code="invalid_code")
    user.email_verified_at = user.email_verified_at or _now()  # receiving the code proves ownership
    return _start(db, user, user_agent)


def request_password_reset(db: Session, email: str) -> None:
    if _by_email(db, email) is not None:
        otp_service.issue(db, email, "reset_password")


def reset_password(db: Session, email: str, code: str, new_password: str, user_agent: str) -> tuple[User, str]:
    otp_service.verify(db, email, "reset_password", code)
    user = _by_email(db, email)
    if user is None:
        raise InvalidInput("That code is incorrect or has expired. Request a new one.", code="invalid_code")
    if user.username in new_password.lower():
        raise InvalidInput("Password must not contain your username")
    user.password_hash = hash_password(new_password)
    user.email_verified_at = user.email_verified_at or _now()
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))  # sign out everywhere else
    return _start(db, user, user_agent)


# ---------------------------------------------------------------- Google
def suggest_username(db: Session, email: str) -> str:
    base = re.sub(r"[^a-z0-9_.-]", "", email.split("@")[0].lower())[:24] or "user"
    base = base if len(base) >= 3 else f"{base}user"
    candidate, n = base, 1
    while db.scalar(select(User.id).where(User.username == candidate)) is not None:
        n += 1
        candidate = f"{base}{n}"
    return candidate


def google_sign_in(db: Session, identity: GoogleIdentity, username: str | None, user_agent: str) -> tuple[User, str]:
    user = db.scalar(select(User).where(User.google_sub == identity.sub))
    if user is None:
        user = db.scalar(select(User).where(User.email == identity.email, User.email_verified_at.is_not(None)))
        if user is not None:
            user.google_sub = identity.sub  # same verified email: link Google to the existing account
    if user is not None:
        return _start(db, user, user_agent)

    # New account: the person must pick their public username first.
    if username is None:
        raise Conflict("Choose a username to finish creating your account.", code="username_required",
                       extra={"email": identity.email, "suggested_username": suggest_username(db, identity.email)})
    _drop_unverified(db, identity.email)
    user = User(username=username, email=identity.email, email_verified_at=_now(), google_sub=identity.sub)
    db.add(user)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise Conflict("That username is taken", code="username_taken") from exc
    return _start(db, user, user_agent)


# ---------------------------------------------------------------- signed-in account management
def logout(db: Session, current: CurrentUser) -> None:
    db.execute(delete(AuthSession).where(AuthSession.id == current.session_id))
    db.commit()


def change_password(db: Session, current: CurrentUser, current_password: str, new_password: str) -> None:
    if current.username in new_password.lower():
        raise InvalidInput("Password must not contain your username")
    user = db.get_one(User, current.id)
    if user.password_hash is None:
        raise InvalidInput("Your account has no password yet. Use “Forgot password” on the sign-in page to set one.",
                           code="no_password")
    if not verify_password(user.password_hash, current_password):
        raise Forbidden("Current password is incorrect")
    user.password_hash = hash_password(new_password)
    session_service.revoke_others(db, current.id, current.session_id)  # sign out every other device
    db.commit()


def request_delete_code(db: Session, current: CurrentUser) -> None:
    user = db.get_one(User, current.id)
    if not user.email:
        raise InvalidInput("Your account has no email address. Confirm with your password instead.")
    otp_service.issue(db, user.email, "delete_account")


def delete_account(db: Session, current: CurrentUser, password: str | None, code: str | None) -> None:
    user = db.get_one(User, current.id)
    if code:
        if not user.email:
            raise InvalidInput("Your account has no email address. Confirm with your password instead.")
        otp_service.verify(db, user.email, "delete_account", code)
    elif not verify_password(user.password_hash, password or ""):
        raise Forbidden("Password is incorrect")
    # ON DELETE CASCADE removes sessions, keys, contacts, blocks and messages.
    db.execute(delete(User).where(User.id == current.id))
    db.commit()


def delete_stale_unverified(db: Session) -> int:
    """Free usernames/emails held by sign-ups that were never verified."""
    cutoff = _now() - timedelta(hours=settings.unverified_account_hours)
    result = db.execute(delete(User).where(and_(
        User.email.is_not(None), User.email_verified_at.is_(None), User.created_at < cutoff,
    )))
    return result.rowcount or 0
