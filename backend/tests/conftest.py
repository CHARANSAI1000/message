import base64
import os
import uuid

import pytest

# Integration tests run against a real, disposable PostgreSQL database.
os.environ.setdefault("DATABASE_URL", "postgresql://postgres@127.0.0.1:55432/messenger_test")
os.environ["ENVIRONMENT"] = "test"
os.environ["SMTP_HOST"] = ""  # never send real email from tests
os.environ["EMAIL_PROVIDER"] = "smtp"
os.environ["CLEANUP_INTERVAL_SECONDS"] = "0"  # tests call cleanup explicitly
os.environ["GOOGLE_CLIENT_ID"] = "test-client.apps.googleusercontent.com"

from fastapi.testclient import TestClient  # noqa: E402

from sqlalchemy import text  # noqa: E402

from app.core.database import engine  # noqa: E402
from app.core.rate_limit import limiter  # noqa: E402
from app.main import app  # noqa: E402
from app.services import email_service  # noqa: E402

OUTBOX: list[dict] = []


@pytest.fixture(autouse=True)
def outbox(monkeypatch):
    """Capture emails instead of sending them."""
    OUTBOX.clear()
    monkeypatch.setattr(email_service, "send", lambda to, subject, text, html, **_: OUTBOX.append(
        {"to": to, "subject": subject, "text": text, "html": html}))
    return OUTBOX


def last_code(email: str) -> str:
    import re
    message = next(m for m in reversed(OUTBOX) if m["to"] == email)
    return re.search(r"\b(\d{6})\b", message["text"]).group(1)

PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="session")
def _app():
    with TestClient(app):  # runs lifespan: opens pool, applies migrations
        yield app


@pytest.fixture(autouse=True)
def clean(_app):
    sql("TRUNCATE users, sessions, public_keys, contacts, blocks, messages, email_codes CASCADE")
    limiter.reset()
    yield


def sql(statement: str) -> list:
    """Run raw SQL directly against the test database (for assertions on stored data)."""
    with engine.begin() as conn:
        result = conn.execute(text(statement))
        return result.fetchall() if result.returns_rows else []


def make_client() -> TestClient:
    return TestClient(app, headers={"X-Requested-With": "fetch"})


@pytest.fixture
def client():
    return make_client()


def fake_spki() -> str:
    # Shape-valid placeholder; the server treats key bytes as opaque.
    return base64.b64encode(os.urandom(91)).decode()


def register(username: str, with_key: bool = True) -> tuple[TestClient, dict]:
    """Full email sign-up: register, read the emailed code, verify (which signs in)."""
    c = make_client()
    email = f"{username}@example.com"
    r = c.post("/api/v1/auth/register", json={"email": email, "username": username, "password": PASSWORD})
    assert r.status_code == 202, r.text
    r = c.post("/api/v1/auth/verify-email", json={"email": email, "code": last_code(email)})
    assert r.status_code == 200, r.text
    me = r.json()
    if with_key:
        k = c.post("/api/v1/keys", json={"spki": fake_spki()})
        assert k.status_code == 201, k.text
        me["key_id"] = k.json()["key_id"]
    return c, me


def envelope(sender: dict, recipient: dict, **overrides) -> dict:
    body = {
        "id": str(uuid.uuid4()),
        "recipient_id": recipient["id"],
        "sender_key_id": sender["key_id"],
        "recipient_key_id": recipient["key_id"],
        "iv": base64.b64encode(os.urandom(12)).decode(),
        "ciphertext": base64.b64encode(os.urandom(64)).decode(),
        "ttl_seconds": None,
    }
    body.update(overrides)
    return body
