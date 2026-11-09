"""Password hashing, session-token primitives and client IP resolution."""

import hashlib
import secrets
import threading

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError, VerifyMismatchError
from fastapi import Request

from app.core.config import settings

# Argon2id (RFC 9106 low-memory profile: 64 MiB). The semaphore caps concurrent
# hashes so a burst of logins cannot exhaust RAM on a 512 MB free instance.
password_hasher = PasswordHasher()
_hash_slots = threading.BoundedSemaphore(2)
_DUMMY_HASH = password_hasher.hash("timing-equalizer-for-unknown-users")


def hash_password(password: str) -> str:
    with _hash_slots:
        return password_hasher.hash(password)


def verify_password(stored_hash: str | None, password: str) -> bool:
    """Constant-work check: unknown users still cost one Argon2 verification."""
    with _hash_slots:
        try:
            password_hasher.verify(stored_hash or _DUMMY_HASH, password)
        except (VerifyMismatchError, VerificationError, InvalidHashError):
            return False
    return stored_hash is not None


def needs_rehash(stored_hash: str) -> bool:
    return password_hasher.check_needs_rehash(stored_hash)


def new_session_token() -> tuple[str, bytes]:
    """Return (token for the cookie, SHA-256 digest for the database)."""
    token = secrets.token_urlsafe(32)
    return token, hash_token(token)


def hash_token(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


def client_ip(request: Request) -> str:
    if settings.client_ip_header:
        value = request.headers.get(settings.client_ip_header, "").strip()
        if value:
            return value[:64]
    hops = settings.trusted_proxy_hops
    if hops > 0:
        forwarded = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        # Trusted proxies append, so the client address is `hops` entries from the right.
        # Entries further left are client-controlled and are ignored.
        if len(forwarded) >= hops:
            return forwarded[-hops]
    return request.client.host if request.client else "unknown"
