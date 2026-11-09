# Local development (macOS/Linux). Run `make help` for the list.
SHELL := /bin/bash
APP_PORT ?= 8080

.PHONY: help env install db backend frontend test docker docker-logs stop clean mobile-sync android apk ios vapid

help: ## Show commands
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-12s %s\n", $$1, $$2}'

env: ## Create .env files with a random database password (once)
	@if [ ! -f .env ]; then \
	  PW=$$(python3 -c "import secrets;print(secrets.token_urlsafe(24))"); \
	  sed "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$$PW/" .env.example > .env; \
	  sed "s/change-me-to-a-long-random-string/$$PW/" backend/.env.example > backend/.env; \
	  echo "Created .env and backend/.env"; \
	else echo ".env already exists"; fi

install: ## Install backend (venv) and frontend dependencies
	cd backend && python3 -m venv .venv && .venv/bin/pip install -q -r requirements-dev.txt
	cd frontend && npm install

db: env ## Start PostgreSQL in Docker (localhost:5440)
	docker compose up -d --wait db

backend: ## Run FastAPI with auto-reload on http://localhost:8010
	cd backend && .venv/bin/uvicorn app.main:app --reload --port 8010

frontend: ## Run Vite dev server on http://localhost:5173
	cd frontend && npm run dev

test: ## Run backend + frontend tests (needs `make db`; uses a separate messenger_test database)
	docker compose exec -T db psql -U messenger -d messenger -tAc "SELECT 1 FROM pg_database WHERE datname='messenger_test'" | grep -q 1 \
	  || docker compose exec -T db createdb -U messenger messenger_test
	cd backend && set -a && source .env && set +a && \
	  DATABASE_URL=$${DATABASE_URL%/messenger}/messenger_test .venv/bin/python -m pytest -q
	cd frontend && npm test

docker: env ## Build and run the full stack in Docker on http://localhost:8080
	docker compose up -d --build --wait
	@echo "Open http://localhost:$(APP_PORT)"

docker-logs: ## Follow app container logs
	docker compose logs -f app

stop: ## Stop containers (data is kept)
	docker compose down

clean: ## Stop containers AND delete the database volume
	docker compose down -v

# ---------------------------------------------------------------- mobile apps (Capacitor)
# The apps load your hosted site: set CAP_SERVER_URL to its https:// address, e.g.
#   make android CAP_SERVER_URL=https://foryou.onrender.com
CAP_SERVER_URL ?=

mobile-sync: ## Build the web app and copy it + config into the Android/iOS projects
	cd frontend && npm run build && CAP_SERVER_URL=$(CAP_SERVER_URL) npx cap sync

android: mobile-sync ## Open the Android project in Android Studio
	cd frontend && npx cap open android

apk: mobile-sync ## Build a debug APK (needs Android Studio / JDK) -> frontend/android/app/build/outputs/apk/debug/
	cd frontend/android && ./gradlew assembleDebug

ios: mobile-sync ## Open the iOS project in Xcode
	cd frontend && npx cap open ios

vapid: ## Print a new Web Push (VAPID) key pair for .env / Render
	cd backend && .venv/bin/python scripts/gen_vapid.py
