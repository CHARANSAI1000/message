"""Six-digit one-time codes sent by email (verify email, sign in, reset password, delete account)."""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from html import escape

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.exceptions import InvalidInput
from app.models import EmailCode
from app.services import email_service

SUBJECTS = {
    "verify_email": ("Verify your email", "Use this code to confirm your email address and finish creating your ForYou account."),
    "login": ("Your sign-in code", "Use this code to sign in to ForYou."),
    "reset_password": ("Reset your password", "Use this code to choose a new ForYou password."),
    "delete_account": ("Confirm account deletion", "Use this code to permanently delete your ForYou account."),
}


def _hash(salt: bytes, code: str) -> bytes:
    return hashlib.sha256(salt + code.encode()).digest()


def issue(db: Session, email: str, purpose: str) -> None:
    """Create a fresh code (replacing older ones for the same purpose) and email it."""
    code = f"{secrets.randbelow(1_000_000):06d}"
    salt = secrets.token_bytes(16)
    db.execute(delete(EmailCode).where(EmailCode.email == email, EmailCode.purpose == purpose))
    db.add(EmailCode(
        email=email, purpose=purpose, salt=salt, code_hash=_hash(salt, code),
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=settings.otp_ttl_minutes),
    ))
    db.commit()

    subject, intro = SUBJECTS[purpose]
    minutes = settings.otp_ttl_minutes
    text = (f"{intro}\n\n    {code}\n\nThe code expires in {minutes} minutes. "
            "If you didn't request it, you can ignore this email — nobody can use it without access to your inbox.\n\n— ForYou")
    html = f"""<!doctype html><html><body style="margin:0;background:#f6f7fb;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border:1px solid #e4e6ee;border-radius:16px">
<tr><td style="padding:28px 28px 8px"><div style="font-size:20px;font-weight:700;letter-spacing:-0.02em">For<span style="color:#7c3aed">You</span></div></td></tr>
<tr><td style="padding:8px 28px 0"><h1 style="margin:0 0 8px;font-size:20px">{escape(subject)}</h1>
<p style="margin:0;color:#4b5567;font-size:15px;line-height:1.5">{escape(intro)}</p></td></tr>
<tr><td style="padding:22px 28px"><div style="font-family:SFMono-Regular,Menlo,Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:10px;text-align:center;background:#eef0ff;color:#4338ca;border-radius:12px;padding:16px 0">{code}</div></td></tr>
<tr><td style="padding:0 28px 28px;color:#8a93a6;font-size:13px;line-height:1.5">This code expires in {minutes} minutes. If you didn't request it, you can safely ignore this email.</td></tr>
</table></td></tr></table></body></html>"""
    email_service.send(email, f"{code} is your ForYou code — {subject.lower()}", text, html, dev_hint=f"(code {code})")


def verify(db: Session, email: str, purpose: str, code: str) -> None:
    """Consume a valid code or raise. Wrong guesses are counted; the code dies after too many."""
    invalid = InvalidInput("That code is incorrect or has expired. Request a new one.", code="invalid_code")
    row = db.scalar(
        select(EmailCode)
        .where(EmailCode.email == email, EmailCode.purpose == purpose,
               EmailCode.expires_at > datetime.now(timezone.utc))
        .order_by(EmailCode.id.desc())
        .limit(1)
    )
    if row is None or row.attempts >= settings.otp_max_attempts:
        raise invalid
    if not (code.isdigit() and len(code) == 6 and hmac.compare_digest(row.code_hash, _hash(row.salt, code))):
        row.attempts += 1
        db.commit()
        raise invalid
    db.delete(row)
    db.flush()  # caller commits together with whatever the code unlocks


def delete_expired(db: Session) -> int:
    result = db.execute(delete(EmailCode).where(EmailCode.expires_at < datetime.now(timezone.utc)))
    return result.rowcount or 0
