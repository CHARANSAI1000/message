"""Firebase Cloud Messaging (HTTP v1) for the installed Android / iPhone apps.

Configure FCM_SERVICE_ACCOUNT_JSON with a Firebase service-account key (JSON text or base64 of it).
Calls are sent on the high-priority "calls" channel with the ringtone sound; payloads never contain
message text.
"""

import base64
import json
import logging
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

import jwt
from sqlalchemy import delete, select

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import DeviceToken

log = logging.getLogger(__name__)
SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
_lock = threading.Lock()
_token: tuple[str, float] | None = None
_account: dict | None = None


def _service_account() -> dict | None:
    global _account
    raw = settings.fcm_service_account_json.strip()
    if not raw:
        return None
    if _account is None:
        text = raw if raw.startswith("{") else base64.b64decode(raw).decode()
        _account = json.loads(text)
    return _account


def enabled() -> bool:
    return _service_account() is not None


def _access_token() -> str:
    global _token
    with _lock:
        if _token and _token[1] - 60 > time.time():
            return _token[0]
        acct = _service_account()
        assert acct is not None
        now = int(time.time())
        assertion = jwt.encode(
            {"iss": acct["client_email"], "scope": SCOPE, "aud": acct["token_uri"], "iat": now, "exp": now + 3600},
            acct["private_key"], algorithm="RS256",
        )
        body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion})
        req = urllib.request.Request(acct["token_uri"], data=body.encode(), method="POST",
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read())
        _token = (data["access_token"], now + int(data.get("expires_in", 3600)))
        return _token[0]


def build_message(token: str, payload: dict) -> dict:
    is_call = payload.get("type") == "call"
    sender = str(payload.get("from", "Someone"))
    title = f"Incoming {'video' if payload.get('video') else 'voice'} call" if is_call else "ForYou"
    body = f"{sender} is calling you" if is_call else f"New message from {sender}"
    tag = str(payload.get("tag", "foryou"))
    return {
        "token": token,
        "notification": {"title": title, "body": body},
        "data": {k: str(v) for k, v in payload.items()},
        "android": {
            "priority": "HIGH",
            "ttl": "45s" if is_call else "3600s",
            "notification": {
                "channel_id": "calls" if is_call else "messages",
                "sound": "ringtone" if is_call else "default",
                "tag": tag,
                "default_vibrate_timings": not is_call,
                **({"vibrate_timings": ["0.6s", "0.3s", "0.6s", "0.3s", "0.6s"]} if is_call else {}),
            },
        },
        "apns": {
            "headers": {"apns-priority": "10", "apns-collapse-id": tag[:64]},
            "payload": {"aps": {"sound": "ringtone.caf" if is_call else "default", "thread-id": tag}},
        },
    }


def send(user_id: uuid.UUID, payload: dict) -> None:
    acct = _service_account()
    if acct is None:
        return
    with SessionLocal() as db:
        tokens = list(db.scalars(select(DeviceToken.token).where(DeviceToken.user_id == user_id)))
        if not tokens:
            return
        url = f"https://fcm.googleapis.com/v1/projects/{acct['project_id']}/messages:send"
        for token in tokens:
            req = urllib.request.Request(
                url, data=json.dumps({"message": build_message(token, payload)}).encode(), method="POST",
                headers={"Authorization": f"Bearer {_access_token()}", "Content-Type": "application/json"},
            )
            try:
                urllib.request.urlopen(req, timeout=10).close()
            except urllib.error.HTTPError as exc:
                detail = exc.read().decode(errors="ignore")
                if exc.code == 404 or "UNREGISTERED" in detail or "INVALID_ARGUMENT" in detail and "token" in detail:
                    db.execute(delete(DeviceToken).where(DeviceToken.token == token))
                    db.commit()
                else:
                    log.warning("FCM send failed (HTTP %s)", exc.code)
            except Exception:
                log.exception("FCM send failed")


def register(user_id: uuid.UUID, token: str, platform: str) -> None:
    from sqlalchemy.dialects.postgresql import insert

    with SessionLocal() as db:
        db.execute(insert(DeviceToken).values(user_id=user_id, token=token, platform=platform)
                   .on_conflict_do_update(index_elements=["token"], set_={"user_id": user_id, "platform": platform}))
        db.commit()


def unregister(user_id: uuid.UUID, token: str) -> None:
    with SessionLocal() as db:
        db.execute(delete(DeviceToken).where(DeviceToken.user_id == user_id, DeviceToken.token == token))
        db.commit()
