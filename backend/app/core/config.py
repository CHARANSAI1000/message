from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_DATABASE_URL = "postgresql://messenger:messenger@localhost:5432/messenger"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "development"
    database_url: str = DEV_DATABASE_URL
    db_pool_max: int = 5

    # Public origin the browser uses, e.g. https://my-messenger.onrender.com.
    # State-changing requests whose Origin header is not listed are rejected.
    public_origin: str = "http://localhost:8000"
    extra_allowed_origins: str = "http://localhost:5173"

    # Sessions: opaque random token in an HttpOnly cookie; only its SHA-256 is stored.
    session_idle_days: int = 7
    session_absolute_days: int = 30

    # Messages are deleted after this many days even without a disappearing timer.
    max_message_retention_days: int = 30
    max_ciphertext_bytes: int = 48_000
    max_request_bytes: int = 128_000
    cleanup_interval_seconds: int = 300  # 0 disables the background cleanup job (tests)

    # How to find the real client IP for rate limiting (never trust client-supplied values):
    # - CLIENT_IP_HEADER: a header your edge proxy overwrites, e.g. "true-client-ip" on Render/Cloudflare.
    # - TRUSTED_PROXY_HOPS: number of proxies that append to X-Forwarded-For.
    # Neither set: the TCP peer address (safe, but behind a proxy all users share one bucket).
    client_ip_header: str = ""
    trusted_proxy_hops: int = 0

    # Sign in with Google (OAuth 2.0 Web client ID). Empty disables the Google button.
    google_client_id: str = ""

    # Email for one-time codes. Provider "smtp" (e.g. Gmail) or "brevo" (HTTPS API — use this on hosts
    # that block SMTP ports, such as Render's free tier). With neither configured (dev only) codes are logged.
    email_provider: str = "smtp"
    brevo_api_key: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "no-reply@example.com"
    smtp_from_name: str = "ForYou"
    otp_ttl_minutes: int = 10
    otp_max_attempts: int = 5
    unverified_account_hours: int = 24

    # Media: encrypted attachments are stored in PostgreSQL (fine for small/free deployments).
    max_attachment_bytes: int = 10 * 1024 * 1024
    max_avatar_bytes: int = 300 * 1024
    message_edit_minutes: int = 15

    # Calls: STUN is always included. Add a TURN relay for restrictive networks, either static
    # credentials (TURN_URLS comma-separated, TURN_USERNAME, TURN_CREDENTIAL) or Cloudflare Realtime TURN.
    turn_urls: str = ""
    turn_username: str = ""
    turn_credential: str = ""
    cloudflare_turn_key_id: str = ""
    cloudflare_turn_api_token: str = ""

    # Web Push (ring/notify when the app is closed). Generate with `make vapid`.
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:admin@example.com"

    # Firebase Cloud Messaging for the native apps (service-account JSON text, or base64 of it).
    fcm_service_account_json: str = ""

    # Built React app. Served from the same origin, so no CORS is needed.
    static_dir: Path = Path(__file__).resolve().parents[2] / "static"  # backend/static (dev) or /app/static (Docker)

    @property
    def is_production(self) -> bool:
        return self.environment.lower() == "production"

    @property
    def push_enabled(self) -> bool:
        return bool(self.vapid_public_key and self.vapid_private_key)

    @property
    def email_delivery_enabled(self) -> bool:
        if self.email_provider.lower() == "brevo":
            return bool(self.brevo_api_key)
        return bool(self.smtp_host)

    @property
    def allowed_origins(self) -> set[str]:
        origins = {self.public_origin.rstrip("/")}
        if not self.is_production:
            origins |= {o.strip().rstrip("/") for o in self.extra_allowed_origins.split(",") if o.strip()}
        return origins

    @property
    def cookie_name(self) -> str:
        # The __Host- prefix forces Secure, Path=/ and no Domain in the browser.
        return "__Host-sm_session" if self.is_production else "sm_session"

    @model_validator(mode="after")
    def check_production(self):
        if self.is_production:
            if self.database_url == DEV_DATABASE_URL:
                raise ValueError("Production requires DATABASE_URL")
            if not self.public_origin.startswith("https://"):
                raise ValueError("Production requires an https:// PUBLIC_ORIGIN")
            if not self.email_delivery_enabled:
                raise ValueError("Production requires email settings (SMTP_* or EMAIL_PROVIDER=brevo + BREVO_API_KEY)")
        return self


settings = Settings()
