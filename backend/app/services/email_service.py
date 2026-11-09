"""Outgoing email over SMTP (STARTTLS). Sending runs on a small worker pool so requests return
immediately and response time never reveals whether an address has an account."""

import json
import logging
import smtplib
import ssl
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from email.message import EmailMessage
from email.utils import formataddr, make_msgid

from app.core.config import settings

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="smtp")


BREVO_URL = "https://api.brevo.com/v3/smtp/email"


def deliver_brevo(to: str, subject: str, text: str, html: str) -> None:
    """Send through Brevo's HTTPS API (works where outbound SMTP ports are blocked)."""
    payload = {
        "sender": {"name": settings.smtp_from_name, "email": settings.smtp_from_email},
        "to": [{"email": to}],
        "subject": subject,
        "textContent": text,
        "htmlContent": html,
    }
    request = urllib.request.Request(
        BREVO_URL, data=json.dumps(payload).encode(), method="POST",
        headers={"api-key": settings.brevo_api_key, "accept": "application/json", "content-type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=20) as response:  # raises HTTPError on 4xx/5xx
        if response.status >= 300:
            raise RuntimeError(f"Brevo returned HTTP {response.status}")


def deliver(to: str, subject: str, text: str, html: str) -> None:
    """Send synchronously with the configured provider. Raises on failure."""
    if settings.email_provider.lower() == "brevo":
        deliver_brevo(to, subject, text, html)
        return
    msg = EmailMessage()
    msg["From"] = formataddr((settings.smtp_from_name, settings.smtp_from_email))
    msg["To"] = to
    msg["Subject"] = subject
    msg["Message-ID"] = make_msgid(domain=settings.smtp_from_email.split("@")[-1])
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as smtp:
        smtp.starttls(context=ssl.create_default_context())
        if settings.smtp_username:
            smtp.login(settings.smtp_username, settings.smtp_password)
        smtp.send_message(msg)


def _deliver_logged(to: str, subject: str, text: str, html: str) -> None:
    try:
        deliver(to, subject, text, html)
    except Exception:  # never log the message body (it contains a code)
        log.exception("Email delivery failed")


def send(to: str, subject: str, text: str, html: str, *, dev_hint: str = "") -> None:
    """Queue an email. Without SMTP configured (development only) print a hint to the log instead."""
    if not settings.email_delivery_enabled:
        log.warning("Email not configured — would email %s: %s %s", to, subject, dev_hint)
        return
    _pool.submit(_deliver_logged, to, subject, text, html)
