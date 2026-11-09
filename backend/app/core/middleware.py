"""Pure-ASGI middleware: security headers, request-size cap, and CSRF/origin checks."""

from fastapi import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings


def _ws_origins() -> str:
    """WebSocket origins for connect-src ('self' does not cover ws:/wss: in every browser)."""
    out = []
    for origin in sorted(settings.allowed_origins):
        scheme, _, host = origin.partition("://")
        out.append(("wss://" if scheme == "https" else "ws://") + host)
    return " ".join(out)


CSP = "; ".join([
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: blob:",       # decrypted photos are shown from blob: URLs
    "media-src 'self' blob:",           # voice notes, call streams
    f"connect-src 'self' {_ws_origins()}",
    "worker-src 'self'",                # push service worker
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
])
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def body_limit(path: str, method: str) -> int:
    """Uploads get larger limits than ordinary JSON requests."""
    if method == "POST" and path == "/api/v1/attachments":
        return settings.max_attachment_bytes + 1024
    if method == "PUT" and path == "/api/v1/me/avatar":
        return settings.max_avatar_bytes + 1024
    return settings.max_request_bytes


def security_headers(path: str) -> list[tuple[bytes, bytes]]:
    h = [
        (b"x-content-type-options", b"nosniff"),
        (b"referrer-policy", b"no-referrer"),
        (b"x-frame-options", b"DENY"),
        (b"cross-origin-opener-policy", b"same-origin"),
        (b"cross-origin-resource-policy", b"same-origin"),
        # Calls and voice notes need camera/mic/screen for our own origin only.
        (b"permissions-policy", b"camera=(self), microphone=(self), display-capture=(self), geolocation=(), payment=(), usb=()"),
    ]
    # FastAPI's /docs page needs a CDN; it is only enabled outside production.
    if not path.startswith(("/docs", "/openapi.json")):
        h.append((b"content-security-policy", CSP.encode()))
    if settings.is_production:
        h.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
    if path.startswith("/api/"):
        h.append((b"cache-control", b"no-store"))
    return h


class SecurityMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path: str = scope["path"]
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}

        if path.startswith("/api/") and scope["method"] not in SAFE_METHODS:
            origin = headers.get("origin")
            # SameSite=Strict cookies already block most CSRF. In addition, require a custom
            # header (forces a CORS preflight, which this server never approves) and a known Origin.
            if headers.get("x-requested-with") != "fetch" or (origin and origin.rstrip("/") not in settings.allowed_origins):
                await self._reject(JSONResponse({"detail": "Cross-site request rejected"}, 403), scope, receive, send)
                return

        limit = body_limit(path, scope["method"])
        declared = headers.get("content-length")
        if declared is not None and (not declared.isdigit() or int(declared) > limit):
            await self._reject(JSONResponse({"detail": "Request too large"}, 413), scope, receive, send)
            return

        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > limit:
                    raise HTTPException(413, "Request too large")
            return message

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                existing = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    (k, v) for k, v in security_headers(path) if k not in existing
                ]
            await send(message)

        await self.app(scope, limited_receive, send_with_headers)

    @staticmethod
    async def _reject(response: Response, scope: Scope, receive: Receive, send: Send) -> None:
        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + security_headers(scope["path"])
            await send(message)

        await response(scope, receive, send_with_headers)
