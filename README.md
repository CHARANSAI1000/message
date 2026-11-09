# ForYou — secure messenger

A small, self-hosted, end-to-end encrypted one-to-one messenger.

- **Backend:** Python FastAPI + SQLAlchemy 2 (ORM) + Alembic + PostgreSQL.
- **Frontend:** React + TypeScript (Vite). React is its only runtime dependency, and it ships about 76 KB gzipped.
- **Encryption:** the browser's built-in WebCrypto API (ECDH P-256 → HKDF → AES-256-GCM). The server stores only ciphertext.
- **Hosting:** one Docker container. It can run free on Render with a free Neon database; see [docs/deployment.md](docs/deployment.md).

Read [docs/security-architecture.md](docs/security-architecture.md) for what is and isn't protected, and [docs/feature-matrix.md](docs/feature-matrix.md) for status.

## Features

- Username + password accounts (Argon2id). Opaque session tokens live in HttpOnly, SameSite=Strict cookies, and the server stores only their SHA-256 hashes.
- Session list with remote sign-out. Changing the password signs out other devices. You can delete your account.
- End-to-end encrypted one-to-one messages, delivered instantly over WebSocket. Edit (15 min), delete for me / for everyone.
- End-to-end encrypted photos, documents (10 MB) and voice messages.
- End-to-end encrypted voice and video calls, screen sharing (desktop), a Calls tab with history, and ringing while the app is closed (Web Push).
- Notification settings: sounds, silent mode, vibration, ringtones. Profile photo and username change.
- Private keys are non-extractable and never leave the device.
- Safety numbers, key pinning, and a warning when a contact's key changes.
- Disappearing messages (5 min to 1 week). The server deletes everything after 30 days.
- Contacts by exact username (there is no user directory), plus blocking.
- Rate limiting, a strict Content Security Policy, CSRF protection, request size limits, and no message content in logs.

## Run locally

Requirements: Docker Desktop, Python 3.11+, Node 22+. Run `make help` to list every command.

| Service | URL |
|---|---|
| Frontend (Vite, hot reload) | http://localhost:5173 |
| Backend (FastAPI, auto-reload) | http://localhost:8010 (API docs at `/docs`) |
| PostgreSQL (Docker) | localhost:5440 |
| Full Docker app | http://localhost:8080 |

### 1. Local development (hot reload)

```bash
make install     # once: Python venv + npm packages
make db          # creates .env files with a random DB password, starts PostgreSQL in Docker
make backend     # terminal 1: FastAPI on :8010 (applies migrations on start)
make frontend    # terminal 2: open http://localhost:5173
```

Vite proxies `/api` to the backend, so the browser uses one origin, just as in production.

### 2. Full stack in Docker (production-like)

```bash
make docker      # builds one image (React built into FastAPI), open http://localhost:8080
make docker-logs # follow logs
make stop        # stop containers (data kept)
make clean       # stop and DELETE the database volume
```

Ports clash with another project? Change `DB_PORT` / `APP_PORT` in `.env` (and the port in `backend/.env`'s `DATABASE_URL`).

## Tests

```bash
make test        # backend (pytest, separate messenger_test DB) + frontend (vitest); needs `make db`
```

CI (`.github/workflows/ci.yml`) runs both suites, plus `alembic check`, `pip-audit` and `npm audit`, on every push. Dependabot opens weekly update PRs.

## Project layout

```
backend/
  app/
    main.py               app factory: middleware, routers, startup migrations, cleanup job, static client
    core/                 config.py, database.py (SQLAlchemy engine/session, migrations), security.py,
                          rate_limit.py, middleware.py (headers/CSRF/size), exceptions.py
    models/               SQLAlchemy ORM models: user, auth_session, public_key, contact, block, message
    schemas/              Pydantic request/response schemas: auth, key, user, message, common
    services/             business logic + queries: auth, session, key, user, contact, message, maintenance
    routers/              thin HTTP layer: health, auth, keys, users, contacts, messages (+ deps.py)
  migrations/             Alembic migrations (applied automatically on startup)
  tests/                  pytest integration tests against real PostgreSQL

frontend/src/
  main.tsx, App.tsx       entry + top-level flow (session → key → messenger)
  api/                    HTTP client + one module per backend router
  types/                  shared TypeScript types (API shapes, chat, crypto)
  services/               crypto.ts (WebCrypto E2EE), keystore.ts (IndexedDB), vault.ts
  hooks/                  useMessenger (sync polling, decrypted state)
  components/             Avatar, Brand, PageHeading, TabBar
  layouts/                AuthLayout, MessengerLayout
  pages/                  Auth, KeySetup, Chats, Conversation, Contacts, Settings
  utils/, constants/, styles/
```

Request flow: `router` → validates with a `schema` → calls a `service` → reads/writes `models` via SQLAlchemy → returns a `schema`.

## Database migrations (Alembic)

```bash
cd backend
# 1. change or add a model in app/models/
# 2. generate a migration and review it
DATABASE_URL=postgresql://… .venv/bin/alembic revision --autogenerate -m "add something"
# 3. apply (the app also does this automatically on startup)
DATABASE_URL=postgresql://… .venv/bin/alembic upgrade head
```

CI runs `alembic check` to fail the build if models and migrations drift apart.
