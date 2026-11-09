import base64
import os

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.core.config import settings
from app.main import app
from app.services import push_service
from app.services.maintenance_service import cleanup_expired
from tests.conftest import envelope, make_client, register, sql

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
B64 = lambda b: base64.b64encode(b).decode()  # noqa: E731


def upload(c, data: bytes):
    return c.post("/api/v1/attachments", content=data, headers={"content-type": "application/octet-stream"})


# ---------------------------------------------------------------- profile
def test_change_username():
    alice_c, alice = register("alice")
    _, _ = register("bob")
    r = alice_c.patch("/api/v1/me", json={"username": "Alice.New"})
    assert r.status_code == 200 and r.json()["username"] == "alice.new"
    assert alice_c.get("/api/v1/auth/me").json()["username"] == "alice.new"
    assert alice_c.patch("/api/v1/me", json={"username": "bob"}).status_code == 409
    assert alice_c.patch("/api/v1/me", json={"username": "no spaces"}).status_code == 422
    viewer, _ = register("viewer")
    assert viewer.get("/api/v1/users/lookup?username=alice.new").json()["id"] == alice["id"]


def test_profile_photo_upload_and_visibility():
    alice_c, alice = register("alice")
    bob_c, _ = register("bob")
    stranger, _ = register("stranger")
    r = alice_c.put("/api/v1/me/avatar", content=PNG, headers={"content-type": "image/png"})
    assert r.status_code == 200 and r.json()["avatar_version"]
    bob_c.post("/api/v1/contacts", json={"username": "alice"})
    r = bob_c.get(f"/api/v1/users/{alice['id']}/avatar")
    assert r.status_code == 200 and r.headers["content-type"] == "image/png" and r.content == PNG
    assert bob_c.get(f"/api/v1/users/{alice['id']}").json()["avatar_version"]
    assert stranger.get(f"/api/v1/users/{alice['id']}/avatar").status_code == 404
    svg = b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"
    assert alice_c.put("/api/v1/me/avatar", content=svg).status_code == 422
    big = PNG + b"\x00" * (settings.max_avatar_bytes + 10)
    assert alice_c.put("/api/v1/me/avatar", content=big).status_code == 413
    assert alice_c.delete("/api/v1/me/avatar").status_code == 204
    assert bob_c.get(f"/api/v1/users/{alice['id']}/avatar").status_code == 404


# ---------------------------------------------------------------- edit / delete
def test_edit_message_within_window_syncs_by_revision():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    body = envelope(alice, bob)
    sent = alice_c.post("/api/v1/messages", json=body).json()
    cursor = bob_c.get("/api/v1/messages/sync").json()["messages"][-1]["rev"]

    new_ct = B64(os.urandom(70))
    r = alice_c.put(f"/api/v1/messages/{body['id']}", json={"iv": B64(os.urandom(12)), "ciphertext": new_ct})
    assert r.status_code == 200 and r.json()["edited_at"] and r.json()["rev"] > sent["rev"]
    changed = bob_c.get(f"/api/v1/messages/sync?after={cursor}").json()["messages"]
    assert [m["id"] for m in changed] == [body["id"]] and changed[0]["ciphertext"] == new_ct

    assert bob_c.put(f"/api/v1/messages/{body['id']}", json={"iv": B64(os.urandom(12)), "ciphertext": new_ct}).status_code == 404
    sql("UPDATE messages SET created_at = now() - interval '1 hour'")
    r = alice_c.put(f"/api/v1/messages/{body['id']}", json={"iv": B64(os.urandom(12)), "ciphertext": new_ct})
    assert r.status_code == 403


def test_delete_for_everyone_leaves_tombstone_and_removes_attachment():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    att = upload(alice_c, os.urandom(2000)).json()
    body = envelope(alice, bob, attachment_id=att["id"])
    assert alice_c.post("/api/v1/messages", json=body).status_code == 201
    assert bob_c.request("DELETE", f"/api/v1/messages/{body['id']}").status_code == 404  # only the sender
    r = alice_c.request("DELETE", f"/api/v1/messages/{body['id']}")
    assert r.status_code == 200 and r.json()["deleted"] and r.json()["ciphertext"] == ""
    synced = bob_c.get("/api/v1/messages/sync").json()["messages"][0]
    assert synced["deleted"] and synced["ciphertext"] == "" and synced["attachment_id"] is None
    assert sql("SELECT count(*) FROM attachments")[0][0] == 0
    assert alice_c.put(f"/api/v1/messages/{body['id']}", json={"iv": B64(os.urandom(12)), "ciphertext": "AA=="}).status_code == 409


# ---------------------------------------------------------------- attachments
def test_attachment_access_is_limited_to_conversation():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    eve_c, eve = register("eve")
    data = os.urandom(300_000)  # larger than the normal 128 KB request cap
    att = upload(alice_c, data)
    assert att.status_code == 201
    att_id = att.json()["id"]
    assert bob_c.get(f"/api/v1/attachments/{att_id}").status_code == 404  # not shared yet
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, attachment_id=att_id)).status_code == 201
    r = bob_c.get(f"/api/v1/attachments/{att_id}")
    assert r.status_code == 200 and r.content == data
    assert eve_c.get(f"/api/v1/attachments/{att_id}").status_code == 404
    # Eve cannot attach someone else's upload to her own message.
    assert eve_c.post("/api/v1/messages", json=envelope(eve, bob, attachment_id=att_id)).status_code == 422


def test_attachment_limits_and_orphan_cleanup():
    alice_c, _ = register("alice")
    assert alice_c.post("/api/v1/attachments", content=b"x" * 10, headers={"content-type": "image/png"}).status_code == 422
    assert upload(alice_c, b"").status_code == 422
    assert upload(alice_c, b"x" * (settings.max_attachment_bytes + 2048)).status_code == 413
    upload(alice_c, b"orphan")
    sql("UPDATE attachments SET created_at = now() - interval '2 hours'")
    cleanup_expired()
    assert sql("SELECT count(*) FROM attachments")[0][0] == 0


# ---------------------------------------------------------------- realtime + calls
ORIGIN = {"origin": settings.public_origin}


def ws_headers(c) -> dict:
    return {**ORIGIN, "cookie": f"{settings.cookie_name}={c.cookies.get(settings.cookie_name)}"}


def test_ice_servers_always_include_stun(client):
    c, _ = register("alice")
    servers = c.get("/api/v1/calls/ice-servers").json()["ice_servers"]
    assert any("stun:" in u for s in servers for u in s["urls"])


def test_websocket_rejects_bad_origin_and_anonymous():
    c, _ = register("alice")
    with TestClient(app) as tc:
        with pytest.raises(WebSocketDisconnect):
            with tc.websocket_connect("/api/v1/ws", headers={"origin": "https://evil.example", "cookie": ws_headers(c)["cookie"]}) as ws:
                ws.receive_json()
        with pytest.raises(WebSocketDisconnect):
            with tc.websocket_connect("/api/v1/ws", headers=ORIGIN) as ws:
                ws.receive_json()


def test_signal_relay_sync_nudge_and_blocking(monkeypatch):
    pushes = []
    monkeypatch.setattr(push_service, "notify", lambda user_id, payload, **kw: pushes.append(payload))
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws", headers=ws_headers(alice_c)) as a_ws, \
             tc.websocket_connect("/api/v1/ws", headers=ws_headers(bob_c)) as b_ws:
            a_ws.send_json({"type": "ping"})
            assert a_ws.receive_json() == {"type": "pong"}

            a_ws.send_json({"type": "signal", "to": bob["id"], "hint": "offer", "video": True, "payload": {"iv": "x", "ct": "y"}})
            got = b_ws.receive_json()
            assert got == {"type": "signal", "from": alice["id"], "from_name": "alice", "payload": {"iv": "x", "ct": "y"}}
            assert pushes and pushes[-1]["type"] == "call" and pushes[-1]["video"] is True

            # Sending a message nudges both sides to sync (no content over the socket).
            tc.post("/api/v1/messages", json=envelope(alice, bob), headers={**ORIGIN, "X-Requested-With": "fetch",
                                                                             "cookie": ws_headers(alice_c)["cookie"]})
            assert b_ws.receive_json() == {"type": "sync"}
            assert a_ws.receive_json() == {"type": "sync"}
            assert pushes[-1] == {"type": "message", "from": "alice", "tag": f"chat-{alice['id']}"}

            bob_c.put(f"/api/v1/blocks/{alice['id']}")
            a_ws.send_json({"type": "signal", "to": bob["id"], "payload": {"iv": "x", "ct": "y"}})
            assert a_ws.receive_json() == {"type": "signal_failed", "to": bob["id"], "reason": "unavailable"}


def test_call_offer_waits_for_offline_callee(monkeypatch):
    monkeypatch.setattr(push_service, "notify", lambda *a, **kw: None)
    monkeypatch.setattr(settings, "vapid_public_key", "pub")
    monkeypatch.setattr(settings, "vapid_private_key", "priv")
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws", headers=ws_headers(alice_c)) as a_ws:
            a_ws.send_json({"type": "signal", "to": bob["id"], "hint": "offer", "payload": {"iv": "1", "ct": "2"}})
            a_ws.send_json({"type": "ping"})
            assert a_ws.receive_json() == {"type": "pong"}  # no failure: bob may be woken by push
            with tc.websocket_connect("/api/v1/ws", headers=ws_headers(bob_c)) as b_ws:
                assert b_ws.receive_json()["payload"] == {"iv": "1", "ct": "2"}


def test_web_push_payload_is_encrypted_and_sent(monkeypatch):
    """Real pywebpush encryption against a fake push endpoint (no network)."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    b64u = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()  # noqa: E731
    server_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(settings, "vapid_private_key", b64u(server_key.private_numbers().private_value.to_bytes(32, "big")))
    monkeypatch.setattr(settings, "vapid_public_key", "x")
    monkeypatch.setattr(push_service, "_vapid", None)
    browser_key = ec.generate_private_key(ec.SECP256R1())
    p256dh = b64u(browser_key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))

    sent = []

    class Resp:
        status_code = 201
        text = ""

    import pywebpush
    monkeypatch.setattr(pywebpush.requests, "post", lambda url, data=None, headers=None, timeout=None: sent.append((url, data, headers)) or Resp())
    alice_c, alice = register("alice")
    alice_c.post("/api/v1/push/subscribe", json={"endpoint": "https://push.example/abc", "p256dh": p256dh, "auth": b64u(os.urandom(16))})
    push_service._deliver(__import__("uuid").UUID(alice["id"]), {"type": "message", "from": "bob"}, 60, "normal")
    url, data, headers = sent[0]
    assert url == "https://push.example/abc"
    assert b"bob" not in data  # encrypted for the browser
    assert headers["content-encoding"] == "aes128gcm" and headers["authorization"].startswith("vapid ")
