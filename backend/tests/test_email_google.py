import json
import time
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.services import google_service
from app.services.google_service import GoogleIdentity
from app.services.maintenance_service import cleanup_expired
from tests.conftest import OUTBOX, PASSWORD, last_code, make_client, register, sql


def test_config_and_strict_csp(client):
    assert client.get("/api/v1/auth/config").json() == {"google": True, "email_codes": True, "push_public_key": None}
    # Google sign-in uses a redirect, so no third-party script/frame is ever allowed.
    csp = client.get("/healthz").headers["content-security-policy"]
    assert "google" not in csp and "frame-src 'none'" in csp


def test_verification_email_contains_code_and_only_hash_is_stored(client):
    client.post("/api/v1/auth/register", json={"email": "ann@example.com", "username": "ann", "password": PASSWORD})
    code = last_code("ann@example.com")
    assert code in OUTBOX[-1]["html"] and "verify your email" in OUTBOX[-1]["subject"]
    stored = sql("SELECT code_hash FROM email_codes")[0][0]
    assert code.encode() not in bytes(stored)


def test_unverified_login_is_blocked_and_resends_code():
    c = make_client()
    c.post("/api/v1/auth/register", json={"email": "uma@example.com", "username": "uma", "password": PASSWORD})
    first = last_code("uma@example.com")
    r = c.post("/api/v1/auth/login", json={"identifier": "uma", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["code"] == "email_unverified" and r.json()["email"] == "uma@example.com"
    second = last_code("uma@example.com")
    # The old code was replaced by the new one.
    if first != second:
        assert c.post("/api/v1/auth/verify-email", json={"email": "uma@example.com", "code": first}).status_code == 422
    assert c.post("/api/v1/auth/verify-email", json={"email": "uma@example.com", "code": second}).status_code == 200
    assert make_client().post("/api/v1/auth/login", json={"identifier": "uma", "password": PASSWORD}).status_code == 200


def test_unverified_users_are_hidden_from_lookup():
    viewer, _ = register("viewer")
    make_client().post("/api/v1/auth/register", json={"email": "ghost@example.com", "username": "ghost", "password": PASSWORD})
    assert viewer.get("/api/v1/users/lookup?username=ghost").status_code == 404


def test_code_dies_after_too_many_wrong_guesses():
    c = make_client()
    c.post("/api/v1/auth/register", json={"email": "gus@example.com", "username": "gus", "password": PASSWORD})
    code = last_code("gus@example.com")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        r = c.post("/api/v1/auth/verify-email", json={"email": "gus@example.com", "code": wrong})
        assert r.status_code == 422 and r.json()["code"] == "invalid_code"
    assert c.post("/api/v1/auth/verify-email", json={"email": "gus@example.com", "code": code}).status_code == 422


def test_expired_code_rejected():
    c = make_client()
    c.post("/api/v1/auth/register", json={"email": "exp@example.com", "username": "expy", "password": PASSWORD})
    sql("UPDATE email_codes SET expires_at = now() - interval '1 second'")
    assert c.post("/api/v1/auth/verify-email", json={"email": "exp@example.com", "code": last_code("exp@example.com")}).status_code == 422


def test_passwordless_code_login_does_not_reveal_accounts():
    register("lena", with_key=False)
    OUTBOX.clear()
    c = make_client()
    unknown = c.post("/api/v1/auth/code/request", json={"email": "nobody@example.com"})
    known = c.post("/api/v1/auth/code/request", json={"email": "lena@example.com"})
    assert unknown.status_code == known.status_code == 202 and unknown.json() == known.json()
    assert [m["to"] for m in OUTBOX] == ["lena@example.com"]
    r = c.post("/api/v1/auth/code/verify", json={"email": "lena@example.com", "code": last_code("lena@example.com")})
    assert r.status_code == 200 and r.json()["username"] == "lena"


def test_password_reset_signs_out_everywhere():
    old_device, _ = register("rita", with_key=False)
    c = make_client()
    assert c.post("/api/v1/auth/password/forgot", json={"email": "rita@example.com"}).status_code == 202
    r = c.post("/api/v1/auth/password/reset", json={
        "email": "rita@example.com", "code": last_code("rita@example.com"), "new_password": "a brand new passphrase",
    })
    assert r.status_code == 200
    assert old_device.get("/api/v1/auth/me").status_code == 401
    assert make_client().post("/api/v1/auth/login", json={"identifier": "rita", "password": PASSWORD}).status_code == 401
    assert make_client().post("/api/v1/auth/login", json={"identifier": "rita", "password": "a brand new passphrase"}).status_code == 200


def test_email_squatter_is_replaced_by_real_owner():
    make_client().post("/api/v1/auth/register", json={"email": "vic@example.com", "username": "squatter", "password": PASSWORD})
    c = make_client()
    r = c.post("/api/v1/auth/register", json={"email": "vic@example.com", "username": "realvic", "password": PASSWORD})
    assert r.status_code == 202
    assert c.post("/api/v1/auth/verify-email", json={"email": "vic@example.com", "code": last_code("vic@example.com")}).status_code == 200
    assert [r[0] for r in sql("SELECT username FROM users")] == ["realvic"]


def test_stale_unverified_signups_are_cleaned_up():
    make_client().post("/api/v1/auth/register", json={"email": "old@example.com", "username": "oldie", "password": PASSWORD})
    sql("UPDATE users SET created_at = now() - interval '2 days'")
    cleanup_expired()
    assert sql("SELECT count(*) FROM users")[0][0] == 0


# ---------------------------------------------------------------- Google
def start(c) -> str:
    """Begin the redirect flow; returns the `state` Google would send back."""
    r = c.get("/api/v1/auth/google/start", follow_redirects=False)
    assert r.status_code == 302
    return parse_qs(urlparse(r.headers["location"]).query)["state"][0]


@pytest.fixture
def google(monkeypatch):
    identity = {"value": GoogleIdentity(sub="g-123", email="gina@gmail.com", name="Gina")}
    monkeypatch.setattr(google_service, "verify_id_token", lambda credential, nonce: identity["value"])
    return identity


def sign_in(c, username=None):
    body = {"credential": "x" * 40, "state": start(c)}
    if username:
        body["username"] = username
    return c.post("/api/v1/auth/google", json=body)


def test_google_start_redirects_with_state_nonce_and_cookie(client):
    r = client.get("/api/v1/auth/google/start", follow_redirects=False)
    url = urlparse(r.headers["location"])
    q = parse_qs(url.query)
    assert url.netloc == "accounts.google.com"
    assert q["client_id"] == ["test-client.apps.googleusercontent.com"] and q["response_type"] == ["id_token"]
    assert q["redirect_uri"] == [settings.public_origin.rstrip("/") + "/auth/google/callback"]
    assert "openid" in q["scope"][0] and q["nonce"][0] and q["state"][0]
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "max-age=600" in cookie


def test_google_redirect_uses_allowed_dev_origin(client):
    r = client.get("/api/v1/auth/google/start", follow_redirects=False, headers={"host": "localhost:5173"})
    assert parse_qs(urlparse(r.headers["location"]).query)["redirect_uri"] == ["http://localhost:5173/auth/google/callback"]
    r = client.get("/api/v1/auth/google/start", follow_redirects=False, headers={"host": "evil.example"})
    assert "evil" not in r.headers["location"]


def test_google_requires_matching_state(google):
    c = make_client()
    assert c.post("/api/v1/auth/google", json={"credential": "x" * 40, "state": "s" * 20}).status_code == 422  # no cookie
    start(c)
    r = c.post("/api/v1/auth/google", json={"credential": "x" * 40, "state": "wrong-state-123"})
    assert r.status_code == 422 and r.json()["code"] == "google_failed"


def test_google_new_user_must_choose_username(google):
    c = make_client()
    r = sign_in(c)
    assert r.status_code == 409 and r.json()["code"] == "username_required"
    assert r.json()["suggested_username"] == "gina" and r.json()["email"] == "gina@gmail.com"
    r = sign_in(c, "Gina")
    assert r.status_code == 200
    me = r.json()
    assert me["username"] == "gina" and me["email_verified"] and me["google_linked"] and not me["has_password"]
    again = sign_in(make_client())  # next time no username is needed
    assert again.status_code == 200 and again.json()["id"] == me["id"]


def test_google_links_existing_verified_email_account(google):
    _, me = register("gina", with_key=False)
    sql("UPDATE users SET email = 'gina@gmail.com'")
    r = sign_in(make_client())
    assert r.status_code == 200 and r.json()["id"] == me["id"] and r.json()["google_linked"]


def test_google_does_not_inherit_unverified_squatter(google):
    make_client().post("/api/v1/auth/register", json={"email": "gina@gmail.com", "username": "squat", "password": PASSWORD})
    r = sign_in(make_client(), "gina")
    assert r.status_code == 200 and r.json()["username"] == "gina"
    assert [r[0] for r in sql("SELECT username FROM users")] == ["gina"]


def test_google_only_account_password_and_deletion(google):
    c = make_client()
    sign_in(c, "gina")
    r = c.post("/api/v1/auth/password", json={"current_password": "x", "new_password": "a brand new passphrase"})
    assert r.status_code == 422 and r.json()["code"] == "no_password"
    assert c.request("DELETE", "/api/v1/auth/account", json={"password": "anything"}).status_code == 403
    assert c.post("/api/v1/auth/account/delete-code").status_code == 202
    assert c.request("DELETE", "/api/v1/auth/account", json={"code": last_code("gina@gmail.com")}).status_code == 204
    assert sql("SELECT count(*) FROM users")[0][0] == 0


def test_real_id_token_verification(monkeypatch):
    """Exercise the real verifier with a token signed by a local RSA key standing in for Google's."""
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(google_service._jwks, "get_signing_key_from_jwt",
                        lambda token: type("K", (), {"key": key.public_key()})())
    now = int(time.time())
    base = {"iss": "https://accounts.google.com", "aud": "test-client.apps.googleusercontent.com", "sub": "42",
            "email": "Real@Gmail.com", "email_verified": True, "iat": now, "exp": now + 600, "nonce": "n-1"}
    token = lambda **over: jwt.encode({**base, **over}, key, algorithm="RS256")

    identity = google_service.verify_id_token(token(), "n-1")
    assert identity.sub == "42" and identity.email == "real@gmail.com"
    for bad, nonce in [(token(), "other-nonce"), (token(aud="someone-else"), "n-1"), (token(exp=now - 3600), "n-1"),
                       (token(iss="https://evil.example"), "n-1"), (token(email_verified=False), "n-1")]:
        with pytest.raises(Exception):
            google_service.verify_id_token(bad, nonce)
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(Exception):
        google_service.verify_id_token(jwt.encode(base, other_key, algorithm="RS256"), "n-1")


def test_brevo_request_format(monkeypatch):
    from app.core.config import settings
    from app.services import email_service

    sent = {}

    class Resp:
        status = 201
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(request, timeout):
        sent.update(url=request.full_url, headers=dict(request.header_items()), body=json.loads(request.data))
        return Resp()

    monkeypatch.setattr(settings, "email_provider", "brevo")
    monkeypatch.setattr(settings, "brevo_api_key", "xkeysib-test")
    monkeypatch.setattr(email_service.urllib.request, "urlopen", fake_urlopen)
    email_service.deliver("to@example.com", "Subject", "text body", "<p>html</p>")
    assert sent["url"] == "https://api.brevo.com/v3/smtp/email"
    assert sent["headers"]["Api-key"] == "xkeysib-test"
    assert sent["body"]["to"] == [{"email": "to@example.com"}] and sent["body"]["htmlContent"] == "<p>html</p>"
