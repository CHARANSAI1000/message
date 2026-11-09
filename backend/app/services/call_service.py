"""ICE server configuration for WebRTC calls (STUN always; TURN when configured)."""

import json
import logging
import urllib.request

from app.core.config import settings

log = logging.getLogger(__name__)
STUN = [{"urls": ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"]}]
CLOUDFLARE_URL = "https://rtc.live.cloudflare.com/v1/turn/keys/{key_id}/credentials/generate-ice-servers"


def ice_servers() -> list[dict]:
    servers = list(STUN)
    if settings.cloudflare_turn_key_id and settings.cloudflare_turn_api_token:
        try:
            req = urllib.request.Request(
                CLOUDFLARE_URL.format(key_id=settings.cloudflare_turn_key_id),
                data=json.dumps({"ttl": 86400}).encode(), method="POST",
                headers={"Authorization": f"Bearer {settings.cloudflare_turn_api_token}", "Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=8) as resp:
                body = json.loads(resp.read())
            got = body.get("iceServers")
            servers += got if isinstance(got, list) else [got] if got else []
        except Exception:
            log.warning("Could not fetch Cloudflare TURN credentials; calls fall back to STUN only")
    elif settings.turn_urls:
        servers.append({
            "urls": [u.strip() for u in settings.turn_urls.split(",") if u.strip()],
            "username": settings.turn_username,
            "credential": settings.turn_credential,
        })
    return servers
