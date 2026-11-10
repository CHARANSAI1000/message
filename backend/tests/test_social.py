import hashlib
import io
import json
import urllib.error

from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app
from app.services import fcm_service
from tests.conftest import envelope, make_client, register, sql

ORIGIN = {"origin": settings.public_origin}


def ws_headers(c) -> dict:
    return {**ORIGIN, "cookie": f"{settings.cookie_name}={c.cookies.get(settings.cookie_name)}"}


def h(email: str) -> str:
    return hashlib.sha256(email.encode()).hexdigest()


def latest(c, msg_id):
    return next(m for m in c.get("/api/v1/messages/sync").json()["messages"] if m["id"] == msg_id)


# ---------------------------------------------------------------- ticks
def test_sent_delivered_read_ticks():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    body = envelope(alice, bob)
    sent = alice_c.post("/api/v1/messages", json=body).json()
    assert sent["delivered_at"] is None and sent["read_at"] is None          # ✓ sent

    bob_c.get("/api/v1/messages/sync")                                      # bob's device fetches it
    after_delivery = latest(alice_c, body["id"])
    assert after_delivery["delivered_at"] and after_delivery["read_at"] is None  # ✓✓ delivered
    assert after_delivery["rev"] > sent["rev"]                              # alice's cursor picks it up

    assert bob_c.post("/api/v1/messages/read", json={"peer_id": alice["id"], "up_to_seq": sent["seq"]}).status_code == 204
    assert latest(alice_c, body["id"])["read_at"]                           # blue ✓✓


def test_read_receipts_are_reciprocal():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    # Bob turns read receipts off: nothing is recorded when he reads.
    assert bob_c.patch("/api/v1/me/privacy", json={"read_receipts": False}).json()["read_receipts"] is False
    m1 = alice_c.post("/api/v1/messages", json=envelope(alice, bob)).json()
    bob_c.post("/api/v1/messages/read", json={"peer_id": alice["id"], "up_to_seq": m1["seq"]})
    assert sql("SELECT count(*) FROM messages WHERE read_at IS NOT NULL")[0][0] == 0

    # Alice turns hers off: even when Bob (receipts back on) reads, Alice doesn't see it.
    bob_c.patch("/api/v1/me/privacy", json={"read_receipts": True})
    alice_c.patch("/api/v1/me/privacy", json={"read_receipts": False})
    m2 = alice_c.post("/api/v1/messages", json=envelope(alice, bob)).json()
    bob_c.post("/api/v1/messages/read", json={"peer_id": alice["id"], "up_to_seq": m2["seq"]})
    assert sql("SELECT count(*) FROM messages WHERE read_at IS NOT NULL")[0][0] == 2  # both now read
    assert latest(alice_c, m2["id"])["read_at"] is None


def test_cannot_mark_other_peoples_messages_read():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    eve_c, _ = register("eve")
    m = alice_c.post("/api/v1/messages", json=envelope(alice, bob)).json()
    eve_c.post("/api/v1/messages/read", json={"peer_id": alice["id"], "up_to_seq": m["seq"]})
    alice_c.post("/api/v1/messages/read", json={"peer_id": bob["id"], "up_to_seq": m["seq"]})  # sender can't self-read
    assert sql("SELECT count(*) FROM messages WHERE read_at IS NOT NULL")[0][0] == 0


# ---------------------------------------------------------------- contacts from phone
def test_discover_contacts_by_email_hash():
    alice_c, alice = register("alice")
    _, bob = register("bob")
    carol_c, _ = register("carol")
    make_client().post("/api/v1/auth/register", json={"email": "ghost@example.com", "username": "ghost", "password": "correct horse battery"})
    found = alice_c.post("/api/v1/contacts/discover", json={"hashes": [h("bob@example.com"), h("carol@example.com"),
                                                                       h("ghost@example.com"), h("nobody@example.com"),
                                                                       h("alice@example.com")]}).json()
    assert [u["username"] for u in found] == ["bob", "carol"]  # unverified, unknown and self excluded

    carol_c.patch("/api/v1/me/privacy", json={"discoverable": False})
    found = alice_c.post("/api/v1/contacts/discover", json={"hashes": [h("carol@example.com")]}).json()
    assert found == []
    assert alice_c.post("/api/v1/contacts/discover", json={"hashes": ["nothex"]}).status_code == 422


# ---------------------------------------------------------------- native push (FCM)
def test_fcm_call_message_rings_on_calls_channel():
    msg = fcm_service.build_message("tok", {"type": "call", "from": "alice", "video": True, "tag": "call-1"})
    assert msg["notification"]["title"] == "Incoming video call"
    assert msg["android"]["priority"] == "HIGH" and msg["android"]["notification"]["channel_id"] == "calls"
    assert msg["android"]["notification"]["sound"] == "ringtone"
    assert msg["apns"]["headers"]["apns-priority"] == "10"
    text = fcm_service.build_message("tok", {"type": "message", "from": "bob"})
    assert text["notification"]["body"] == "New message from bob" and text["android"]["notification"]["channel_id"] == "messages"


def test_fcm_send_and_dead_token_cleanup(monkeypatch):
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    account = {"project_id": "foryou-test", "client_email": "svc@foryou-test.iam.gserviceaccount.com",
               "private_key": pem, "token_uri": "https://oauth2.googleapis.com/token"}
    monkeypatch.setattr(settings, "fcm_service_account_json", json.dumps(account))
    monkeypatch.setattr(fcm_service, "_account", None)
    monkeypatch.setattr(fcm_service, "_token", None)

    alice_c, alice = register("alice")
    assert alice_c.post("/api/v1/push/device", json={"token": "good-token-0123456789", "platform": "android"}).status_code == 204
    assert alice_c.post("/api/v1/push/device", json={"token": "dead-token-0123456789", "platform": "ios"}).status_code == 204
    assert alice_c.post("/api/v1/push/device", json={"token": "x" * 30, "platform": "windows"}).status_code == 422

    calls = []

    class Resp(io.BytesIO):
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_urlopen(req, timeout):
        calls.append(req)
        if req.full_url.endswith("/token"):
            return Resp(json.dumps({"access_token": "ya29.test", "expires_in": 3600}).encode())
        if b"dead-token" in req.data:
            raise urllib.error.HTTPError(req.full_url, 404, "Not Found", {}, io.BytesIO(b'{"error":{"status":"UNREGISTERED"}}'))
        return Resp(b"{}")

    monkeypatch.setattr(fcm_service.urllib.request, "urlopen", fake_urlopen)
    fcm_service.send(__import__("uuid").UUID(alice["id"]), {"type": "call", "from": "bob", "video": False})
    sends = [c for c in calls if "messages:send" in c.full_url]
    assert len(sends) == 2 and sends[0].headers["Authorization"] == "Bearer ya29.test"
    assert "projects/foryou-test/" in sends[0].full_url
    assert [r[0] for r in sql("SELECT token FROM device_tokens")] == ["good-token-0123456789"]


# ---------------------------------------------------------------- typing + presence
def test_typing_and_presence_over_websocket():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    alice_c.post("/api/v1/contacts", json={"username": "bob"})
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws", headers=ws_headers(alice_c)) as a_ws:
            a_ws.send_json({"type": "presence_watch", "user": bob["id"]})
            first = a_ws.receive_json()
            assert first["type"] == "presence" and first["online"] is False

            with tc.websocket_connect("/api/v1/ws", headers=ws_headers(bob_c)) as b_ws:
                assert a_ws.receive_json() == {**first, "online": True, "last_seen": first["last_seen"]}
                b_ws.send_json({"type": "typing", "to": alice["id"], "state": True})
                assert a_ws.receive_json() == {"type": "typing", "from": bob["id"], "state": True}

            offline = a_ws.receive_json()
            assert offline["online"] is False and offline["last_seen"]  # last seen recorded on disconnect


def test_presence_hidden_by_privacy_and_for_strangers():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    stranger_c, _ = register("stranger")
    alice_c.post("/api/v1/contacts", json={"username": "bob"})
    bob_c.patch("/api/v1/me/privacy", json={"show_presence": False})
    with TestClient(app) as tc:
        with tc.websocket_connect("/api/v1/ws", headers=ws_headers(alice_c)) as a_ws:
            a_ws.send_json({"type": "presence_watch", "user": bob["id"]})
            assert a_ws.receive_json() == {"type": "presence", "user": bob["id"], "hidden": True}
        with tc.websocket_connect("/api/v1/ws", headers=ws_headers(stranger_c)) as s_ws:
            s_ws.send_json({"type": "presence_watch", "user": alice["id"]})
            assert s_ws.receive_json() == {"type": "presence", "user": alice["id"], "hidden": True}
