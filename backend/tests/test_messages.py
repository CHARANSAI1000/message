import uuid

from app.services.maintenance_service import cleanup_expired
from tests.conftest import envelope, register, sql


def test_unauthenticated_requests_rejected(client):
    assert client.get("/api/v1/messages/sync").status_code == 401
    assert client.get("/api/v1/contacts").status_code == 401


def test_message_roundtrip_is_visible_only_to_participants():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    carol_c, _ = register("carol")

    body = envelope(alice, bob)
    sent = alice_c.post("/api/v1/messages", json=body)
    assert sent.status_code == 201, sent.text

    received = bob_c.get("/api/v1/messages/sync").json()["messages"]
    assert [m["id"] for m in received] == [body["id"]]
    assert received[0]["ciphertext"] == body["ciphertext"]
    assert alice_c.get("/api/v1/messages/sync").json()["messages"][0]["id"] == body["id"]
    assert carol_c.get("/api/v1/messages/sync").json()["messages"] == []

    seq = received[0]["seq"]
    assert bob_c.get(f"/api/v1/messages/sync?after={seq}").json()["messages"] == []


def test_sync_paginates():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    for _ in range(3):
        assert alice_c.post("/api/v1/messages", json=envelope(alice, bob)).status_code == 201
    page = bob_c.get("/api/v1/messages/sync?limit=2").json()
    assert len(page["messages"]) == 2 and page["has_more"] is True
    rest = bob_c.get(f"/api/v1/messages/sync?after={page['messages'][-1]['seq']}").json()
    assert len(rest["messages"]) == 1 and rest["has_more"] is False


def test_server_rejects_wrong_keys_duplicates_and_bad_input():
    alice_c, alice = register("alice")
    _, bob = register("bob")
    _, carol = register("carol")

    # Sender may not use someone else's key or a recipient key that belongs to another user.
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, sender_key_id=bob["key_id"])).status_code == 409
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, recipient_key_id=carol["key_id"])).status_code == 409

    body = envelope(alice, bob)
    assert alice_c.post("/api/v1/messages", json=body).status_code == 201
    assert alice_c.post("/api/v1/messages", json=body).status_code == 409  # replayed id

    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, ttl_seconds=12345)).status_code == 422
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, iv="AAAA")).status_code == 422
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, ciphertext="not base64!")).status_code == 422
    assert alice_c.post("/api/v1/messages", json=envelope(alice, alice)).status_code == 422


def test_stale_sender_key_rejected_after_rotation():
    alice_c, alice = register("alice")
    _, bob = register("bob")
    old_key = alice["key_id"]
    from tests.conftest import fake_spki
    alice_c.post("/api/v1/keys", json={"spki": fake_spki()})
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob, sender_key_id=old_key)).status_code == 409


def test_blocked_sender_cannot_deliver():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    assert bob_c.put(f"/api/v1/blocks/{alice['id']}").status_code == 204
    assert bob_c.get("/api/v1/blocks").json() == [alice["id"]]
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob)).status_code == 403
    assert bob_c.delete(f"/api/v1/blocks/{alice['id']}").status_code == 204
    assert alice_c.post("/api/v1/messages", json=envelope(alice, bob)).status_code == 201


def test_expired_messages_hidden_and_cleaned_up():
    alice_c, alice = register("alice")
    bob_c, bob = register("bob")
    body = envelope(alice, bob, ttl_seconds=300)
    assert alice_c.post("/api/v1/messages", json=body).status_code == 201
    sql("UPDATE messages SET expires_at = now() - interval '1 second'")
    assert bob_c.get("/api/v1/messages/sync").json()["messages"] == []
    cleanup_expired()
    assert sql("SELECT count(*) FROM messages")[0][0] == 0


def test_contacts_lookup_and_user_privacy():
    alice_c, alice = register("alice")
    _, bob = register("bob")
    _, carol = register("carol")

    found = alice_c.get("/api/v1/users/lookup?username=BOB").json()
    assert found["id"] == bob["id"] and found["key"]["key_id"] == bob["key_id"]
    assert alice_c.get("/api/v1/users/lookup?username=bobb").status_code == 404  # no prefix search

    # Users with no relationship cannot be fetched by id.
    assert alice_c.get(f"/api/v1/users/{carol['id']}").status_code == 404
    assert alice_c.post("/api/v1/contacts", json={"username": "carol"}).status_code == 201
    assert alice_c.get(f"/api/v1/users/{carol['id']}").status_code == 200
    assert [c["username"] for c in alice_c.get("/api/v1/contacts").json()] == ["carol"]
    assert alice_c.post("/api/v1/contacts", json={"username": "alice"}).status_code == 422
    assert alice_c.post("/api/v1/contacts", json={"username": "nobody"}).status_code == 404
    assert alice_c.delete(f"/api/v1/contacts/{carol['id']}").status_code == 204
    assert alice_c.get("/api/v1/contacts").json() == []

    assert alice_c.get(f"/api/v1/keys/{bob['key_id']}").json()["user_id"] == bob["id"]
    assert alice_c.put(f"/api/v1/blocks/{uuid.uuid4()}").status_code == 404
