# Deploying ForYou for free

One Docker container (FastAPI serves the API and the built React app) plus a PostgreSQL database.

| Piece | Free provider | Notes |
|---|---|---|
| App | [Render](https://render.com/docs/free) free web service | Sleeps after 15 minutes without traffic; the first visit after that takes about a minute. **Outbound SMTP is blocked**, so email goes through Brevo. |
| Database | [Neon](https://neon.com) free plan | Persistent. Messages are deleted after 30 days by default, which keeps storage small. |
| Email | [Brevo](https://www.brevo.com) free plan | HTTPS email API, 300 emails/day; you verify one sender address (your Gmail is fine). |
| Google sign-in | Google Cloud (free) | Your existing OAuth client. |

Free tiers change; check each provider's current limits before relying on them.

---

## Step 1 — Put the code on GitHub (private repo)

```bash
cd secure-messenger
git init -b main
git add .
git status            # make sure NO .env file is listed (only .env.example files)
git commit -m "ForYou messenger"
```

On github.com create an **empty private** repository named `foryou`, then:

```bash
git remote add origin https://github.com/<your-username>/foryou.git
git push -u origin main
```

## Step 2 — Database on Neon

1. Sign up at neon.com, then **Create project**. Pick the region closest to where you'll run Render (e.g. Singapore or Frankfurt).
2. Under **Connection details**, turn **off** "Connection pooling" and copy the connection string. It looks like:
   `postgresql://neondb_owner:••••@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. Keep it secret. The app creates its tables automatically on first start.

## Step 3 — Email on Brevo

1. Sign up at brevo.com (free).
2. **Senders, Domains & Dedicated IPs → Senders → Add a sender**: enter your name and your Gmail address, then click the confirmation link Brevo emails you.
3. **SMTP & API → API keys → Generate a new API key**, and copy it (it starts with `xkeysib-`).

`no-reply@foryou.com` only works if you own `foryou.com` and verify it in Brevo. Until then, use your verified Gmail address as the sender.

## Step 4 — Deploy on Render

1. Sign up at render.com with GitHub. Choose **New → Blueprint**, pick the `foryou` repo, and confirm. Render reads `render.yaml`.
2. Fill in the variables it asks for:

   | Variable | Value |
   |---|---|
   | `DATABASE_URL` | Neon string from step 2 |
   | `PUBLIC_ORIGIN` | `https://<service-name>.onrender.com` (no trailing slash) |
   | `GOOGLE_CLIENT_ID` | your OAuth client ID |
   | `BREVO_API_KEY` | key from step 3 |
   | `SMTP_FROM_EMAIL` | the sender you verified in Brevo |

   If you don't know the URL yet, enter a placeholder, deploy, then fix `PUBLIC_ORIGIN` under **Environment** (Render redeploys automatically).
3. Wait for **Live**, then open `https://<your-app>.onrender.com/readyz`. It should show `{"status":"ready"}`.

## Step 5 — Google sign-in

Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 *Web application* client:

- **Authorized redirect URIs** (required):
  - `https://<your-app>.onrender.com/auth/google/callback`
  - `http://localhost:5173/auth/google/callback` (local dev)
  - `http://localhost:8080/auth/google/callback` (local Docker)
- **OAuth consent screen**: while it's in *Testing*, only the test users you list can sign in. Add your Gmail addresses, or click **Publish app** (basic email/profile scopes don't need Google's review).

Changes can take a few minutes to apply. Use `localhost`, not `127.0.0.1`, when testing locally, because Google matches redirect URIs exactly.

## Step 5b — Calls and notifications (optional but recommended)

- **Push notifications:** run `make vapid` on your computer and copy the two lines into Render as `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY`. Set `VAPID_SUBJECT` to `mailto:<your email>`.
- **TURN relay:** without one, calls fail for roughly 1 in 5 network combinations (mobile data, strict office Wi-Fi). Either create a Cloudflare Realtime TURN key and set `CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_API_TOKEN`, or use any TURN provider with `TURN_URLS`, `TURN_USERNAME` and `TURN_CREDENTIAL`.

## Step 6 — Test it

1. Create an account with email: the verification code should arrive (check spam the first time).
2. Sign in with Google in a private window.
3. Add each other as contacts and send a message.

## Updating

Push to `main` and Render redeploys. Database migrations run automatically on start.

```bash
git add . && git commit -m "describe change" && git push
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Cross-site request rejected" | `PUBLIC_ORIGIN` must exactly match the address in the browser (https, no trailing slash) |
| Google: `Error 400: redirect_uri_mismatch` | Add the exact `…/auth/google/callback` URL in step 5 |
| Google: "Access blocked … has not completed verification" | Add yourself as a test user, or publish the consent screen |
| No email arrives | Render logs show `Email delivery failed`. Check `BREVO_API_KEY` and that `SMTP_FROM_EMAIL` is a verified Brevo sender |
| App takes ~1 minute to open | Free instance waking from sleep; normal |
| Deploy fails "Production requires email settings" | Set `BREVO_API_KEY` |

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` enables HSTS, `__Host-` Secure cookies, and turns off API docs |
| `DATABASE_URL` | local | PostgreSQL connection string |
| `PUBLIC_ORIGIN` | `http://localhost:8000` | Exact origin users open; other origins can't make changes |
| `GOOGLE_CLIENT_ID` | empty | OAuth Web client ID; empty hides the Google button |
| `EMAIL_PROVIDER` | `smtp` | `smtp` (Gmail etc.) or `brevo` (HTTPS; required on Render free) |
| `BREVO_API_KEY` | empty | Brevo API key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` | – / 587 / – / – | SMTP settings (local and Docker use Gmail with an App Password) |
| `SMTP_FROM_EMAIL` | `no-reply@example.com` | Sender address (used by both providers) |
| `CLIENT_IP_HEADER` | empty | Proxy header with the real client IP (`true-client-ip` on Render) |
| `MAX_MESSAGE_RETENTION_DAYS` | `30` | Hard cap on how long ciphertext is kept |
| `SESSION_IDLE_DAYS` / `SESSION_ABSOLUTE_DAYS` | `7` / `30` | Session lifetimes |
| `DB_POOL_MAX` | `5` | Max database connections |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | empty | Web Push keys (`make vapid`) for ringing and notifications while closed |
| `CLOUDFLARE_TURN_KEY_ID` / `CLOUDFLARE_TURN_API_TOKEN` | empty | Cloudflare TURN relay for calls |
| `TURN_URLS` / `TURN_USERNAME` / `TURN_CREDENTIAL` | empty | Any other TURN relay |
| `MAX_ATTACHMENT_BYTES` | 10 MB | Largest photo/file/voice note |

## Other hosts

Any host that runs a Dockerfile works with the same variables: Koyeb, Fly.io, Google Cloud Run, or an Oracle Cloud Always Free VM with `docker compose up` behind Caddy for HTTPS. If the host allows outbound port 587, you can use `EMAIL_PROVIDER=smtp` with Gmail instead of Brevo.
