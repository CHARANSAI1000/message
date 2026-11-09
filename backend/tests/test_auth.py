from app.core.config import settings
from tests.conftest import PASSWORD, last_code, make_client, register, sql


def test_health(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert client.get("/readyz").json() == {"status": "ready"}


def test_register_sets_httponly_strict_cookie_and_stores_only_hashes(client):
    r = client.post("/api/v1/auth/register", json={"email": "Alice@Example.com", "username": "Alice_01", "password": PASSWORD})
    assert r.status_code == 202 and r.json()["email"] == "alice@example.com"
    assert client.get("/api/v1/auth/me").status_code == 401  # no session until the email is verified
    r = client.post("/api/v1/auth/verify-email", json={"email": "alice@example.com", "code": last_code("alice@example.com")})
    assert r.status_code == 200
    assert r.json()["username"] == "alice_01" and r.json()["email_verified"] is True
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    token = client.cookies.get(settings.cookie_name)
    pw_hash = sql("SELECT password_hash FROM users")[0][0]
    token_hash = sql("SELECT token_hash FROM sessions")[0][0]
    assert pw_hash.startswith("$argon2id$")
    assert sql("SELECT count(*) FROM email_codes")[0][0] == 0  # code consumed
    assert token.encode() not in bytes(token_hash)
    assert client.get("/api/v1/auth/me").json()["username"] == "alice_01"


def test_weak_and_duplicate_registrations_rejected(client):
    def reg(username, password=PASSWORD, email=None):
        return make_client().post("/api/v1/auth/register",
                                  json={"email": email or f"{username.replace(' ', '')}@example.com", "username": username, "password": password})
    assert reg("bob", "short").status_code == 422
    assert reg("bobby", "my-name-is-bobby!").status_code == 422
    assert reg("bad name").status_code == 422
    assert reg("bob2", email="not-an-email").status_code == 422
    register("bob", with_key=False)
    assert reg("bob", email="other@example.com").status_code == 409  # username taken
    taken = reg("bobcat", email="bob@example.com")  # verified email taken
    assert taken.status_code == 409 and taken.json()["code"] == "email_taken"


def test_login_errors_are_generic_and_rate_limited(client):
    register("carol", with_key=False)
    wrong = client.post("/api/v1/auth/login", json={"identifier": "carol", "password": "wrong password!!"})
    unknown = client.post("/api/v1/auth/login", json={"identifier": "nobody", "password": "wrong password!!"})
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json() == unknown.json()
    codes = [client.post("/api/v1/auth/login", json={"identifier": "carol", "password": "wrong password!!"}).status_code
             for _ in range(10)]
    assert codes[-1] == 429
    # Even the right password is refused while the username is locked out.
    assert client.post("/api/v1/auth/login", json={"identifier": "carol", "password": PASSWORD}).status_code == 429


def test_login_success(client):
    register("dave", with_key=False)
    r = client.post("/api/v1/auth/login", json={"identifier": "DAVE", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["username"] == "dave"
    r = make_client().post("/api/v1/auth/login", json={"identifier": "Dave@Example.com", "password": PASSWORD})
    assert r.status_code == 200 and r.json()["email"] == "dave@example.com"


def test_csrf_protection_requires_custom_header_and_known_origin():
    bare = make_client()
    bare.headers.pop("X-Requested-With")
    body = {"email": "eve@example.com", "username": "eve", "password": PASSWORD}
    assert bare.post("/api/v1/auth/register", json=body).status_code == 403
    evil = make_client()
    r = evil.post("/api/v1/auth/register", json=body,
                  headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    ok = make_client().post("/api/v1/auth/register", json=body, headers={"Origin": settings.public_origin})
    assert ok.status_code == 202


def test_security_headers(client):
    h = client.get("/healthz").headers
    assert "default-src 'self'" in h["content-security-policy"]
    assert "frame-ancestors 'none'" in h["content-security-policy"]
    assert h["x-content-type-options"] == "nosniff"
    assert h["referrer-policy"] == "no-referrer"
    assert h["cross-origin-opener-policy"] == "same-origin"
    assert client.post("/api/v1/auth/login", json={}).headers["cache-control"] == "no-store"


def test_oversized_body_rejected(client):
    r = client.post("/api/v1/auth/login", content=b"x" * (settings.max_request_bytes + 1),
                    headers={"content-type": "application/json"})
    assert r.status_code == 413


def test_logout_invalidates_session():
    c, _ = register("frank", with_key=False)
    assert c.post("/api/v1/auth/logout").status_code == 204
    assert c.get("/api/v1/auth/me").status_code == 401


def test_sessions_listing_revocation_and_password_change():
    c1, _ = register("grace", with_key=False)
    c2 = make_client()
    assert c2.post("/api/v1/auth/login", json={"identifier": "grace", "password": PASSWORD}).status_code == 200
    sessions = c1.get("/api/v1/auth/sessions").json()
    assert len(sessions) == 2
    other = next(s for s in sessions if not s["current"])
    assert c1.delete(f"/api/v1/auth/sessions/{other['id']}").status_code == 204
    assert c2.get("/api/v1/auth/me").status_code == 401

    c3 = make_client()
    c3.post("/api/v1/auth/login", json={"identifier": "grace", "password": PASSWORD})
    bad = c1.post("/api/v1/auth/password", json={"current_password": "nope", "new_password": "another long passphrase"})
    assert bad.status_code == 403
    ok = c1.post("/api/v1/auth/password", json={"current_password": PASSWORD, "new_password": "another long passphrase"})
    assert ok.status_code == 204
    assert c1.get("/api/v1/auth/me").status_code == 200  # current device stays signed in
    assert c3.get("/api/v1/auth/me").status_code == 401  # other devices signed out


def test_delete_account_removes_everything():
    c, me = register("heidi")
    assert c.request("DELETE", "/api/v1/auth/account", json={"password": "wrong"}).status_code == 403
    assert c.request("DELETE", "/api/v1/auth/account", json={"password": PASSWORD}).status_code == 204
    for table in ("users", "public_keys", "sessions"):
        assert sql(f"SELECT count(*) FROM {table}")[0][0] == 0


def test_client_ip_resolution(monkeypatch):
    from starlette.requests import Request

    from app.core.security import client_ip

    def req(headers: dict[str, str]) -> Request:
        return Request({"type": "http", "client": ("10.0.0.1", 1), "headers": [(k.encode(), v.encode()) for k, v in headers.items()]})

    spoofed = {"x-forwarded-for": "6.6.6.6, 1.2.3.4", "true-client-ip": "9.9.9.9"}
    assert client_ip(req(spoofed)) == "10.0.0.1"  # default: never trust headers
    monkeypatch.setattr(settings, "trusted_proxy_hops", 1)
    assert client_ip(req(spoofed)) == "1.2.3.4"  # rightmost entry, added by our proxy
    monkeypatch.setattr(settings, "client_ip_header", "true-client-ip")
    assert client_ip(req(spoofed)) == "9.9.9.9"
