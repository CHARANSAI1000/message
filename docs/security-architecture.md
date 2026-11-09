# Security architecture

## What the server can and cannot see

| The server stores / sees | The server never receives |
|---|---|
| Usernames, Argon2id password hashes | Message text |
| SHA-256 hashes of session tokens, browser user-agent | Private keys (non-extractable in the browser) |
| Public keys | Safety-number verification state |
| Who messaged whom and when, ciphertext size, disappearing timer | Contacts' display data beyond usernames |
| Contacts and block lists | |

Metadata (who talks to whom, and when) is visible to the operator. It is retained for at most `MAX_MESSAGE_RETENTION_DAYS` (default 30), then deleted along with the ciphertext.

## Message encryption

All cryptography uses the browser's built-in WebCrypto API; no custom primitives.

1. On first sign-in, the browser generates an **ECDH P-256** key pair with `extractable: false` and stores the `CryptoKey` in IndexedDB. Page JavaScript can use the private key but cannot read or export it. The public key (SPKI) is uploaded.
2. For a conversation, both sides compute `ECDH(myPrivate, theirPublic)` → **HKDF-SHA-256** (info binds both key ids) → **AES-256-GCM** key. Both parties derive the same key, so one envelope serves both sender and recipient.
3. Each message uses a fresh random 96-bit IV. The message id, sender, recipient, both key ids, and the disappearing timer are bound as GCM additional data. If the server alters, re-routes, or changes the timer on an envelope, decryption fails. Replays are rejected because message ids are unique.
4. **Verification:** each client pins the first key it sees for a contact (trust on first use). If a pinned key id later has different bytes, the client refuses to decrypt. A new key triggers a warning and blocks sending until the user reviews it. Users can compare a 40-digit **safety number** in person or on a call and mark the contact verified.
5. On load, the client checks that the server publishes exactly its own public key.

### Known limitations (be honest with users)

- **No forward secrecy or post-compromise security.** Each account has one static key per browser. Anyone who can use that key, for example malware on the device, can decrypt all stored ciphertext for it. Upgrading to a ratcheting protocol (OpenMLS, RFC 9420, or libsignal) is the next step for this; see the evaluation notes below.
- **Web-delivered crypto trusts the server's JavaScript.** A malicious or compromised server could ship code that leaks plaintext. The strict CSP, no third-party scripts, and HTTPS reduce the risk, but cannot remove it. Native apps or reproducible builds would.
- **One browser per account.** A new browser creates a new key. Old messages are unreadable there, the old browser can no longer send, and contacts get a key-change warning.
- **No account recovery.** There is no email or reset flow, so a forgotten password means a new account.
- **Rate limits are in memory.** That is correct for a single instance, which the free plan provides; multiple replicas would need a shared store.

## Sign-in methods

- **Email verification:** new email accounts can't sign in until a 6-digit code is confirmed. Codes come from `secrets`, are stored only as salted SHA-256 hashes, expire after 10 minutes, are single-use, and die after 5 wrong guesses. Requests and checks are rate-limited per IP and per address.
- **No account enumeration on code requests:** "email me a code" and "forgot password" always answer the same way, and emails are sent from a background pool, so response time doesn't reveal whether an account exists. Registration necessarily reports a taken email or username.
- **Email squatting:** an account that never verified its email doesn't own it. A later sign-up or Google sign-in with that address replaces the unverified account. Unverified sign-ups are deleted after 24 hours.
- **Google:** the ID token's signature (Google JWKS), audience (`GOOGLE_CLIENT_ID`), issuer, expiry and `email_verified` are checked on the server. A Google account links automatically only to an account whose email is already verified.
- **Google redirect flow:** no Google JavaScript runs on our pages, so the strict CSP is unchanged. A random `state` and `nonce` (kept in a 10-minute HttpOnly cookie) protect against forged callbacks and replayed tokens, and the ID token is removed from the address bar immediately.
- **Secrets:** SMTP and other credentials live only in git-ignored `.env` files and the host's secret settings, never in the repository.

## Web and API hardening

- **Sessions:** a 256-bit random opaque token in an `HttpOnly; Secure; SameSite=Strict` cookie, using the `__Host-` prefix in production. The DB stores only its SHA-256 hash. Idle timeout is 7 days and absolute timeout 30 days. Logout, remote revoke, and password change all invalidate server-side immediately.
- **Passwords:** Argon2id (64 MiB), with at most 2 hashes running concurrently so memory stays bounded. Unknown users still cost a full hash, so response timing doesn't reveal which usernames exist, and errors are generic. Passwords need 12–128 characters, must not contain the username, and must not be too repetitive.
- **CSRF:** SameSite=Strict, plus a required `X-Requested-With` header (cross-site requests would need a CORS preflight, which is never approved), plus an Origin allow-list (`PUBLIC_ORIGIN`).
- **XSS:** CSP `default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. There are no inline scripts and no third-party code; React escapes all message text.
- **Headers:** HSTS (2 years), `nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, COOP/CORP same-origin, a restrictive Permissions-Policy, and `Cache-Control: no-store` on the API. The `Server` header is removed.
- **Input limits:** request bodies are capped at 128 KB, ciphertext at 48 KB, and IVs must be exactly 12 bytes. Timers come from an allow-list. Senders must use their *current* key and a key that belongs to the recipient.
- **Privacy:** lookups are exact-username only, with no listing or prefix search. Profiles are visible only to people you share a contact or conversation with. Blocked users cannot deliver.
- **Data lifecycle:** a background job deletes expired sessions and messages every 5 minutes. Account deletion cascades to all rows.
- **Operations:** the container runs as non-root and works with a read-only filesystem. API docs are disabled in production. Logs never include bodies. SQL is fully parameterised. CI runs the tests plus `pip-audit` and `npm audit`, and Dependabot proposes weekly updates.

## Upgrade path: protocol evaluation notes

For forward secrecy and groups, adopt a maintained protocol implementation rather than extending this scheme:

- **OpenMLS** (MIT, RFC 9420): covers 1:1 and groups with forward secrecy and post-compromise security, and was independently audited (SRLabs, 2026). Its WebAssembly targets are built but not fully tested in CI; use ≥ 0.9.2 and watch the [advisories](https://github.com/openmls/openmls/security/advisories).
- **libsignal** (AGPL-3.0-only): the reference Signal Protocol, but its Node builds are native binaries rather than browser modules, and third-party use has open licensing questions ([issue #691](https://github.com/signalapp/libsignal/issues/691)).
- **Calls:** LiveKit/WebRTC with client media E2EE, where the application must generate, store, and distribute the keys itself ([LiveKit encryption](https://docs.livekit.io/transport/encryption/)).

Before any stronger claim, test with multiple clients, inspect DB rows, logs, and backups for plaintext, and keep the matrix in sync.
