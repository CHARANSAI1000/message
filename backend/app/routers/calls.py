"""Real-time channel (WebSocket) and WebRTC call support.

The server only relays call signalling; offers/answers/ICE candidates are end-to-end encrypted by the
clients with the same keys as messages, so the server cannot read or tamper with the media setup.
"""

import asyncio
import json
import logging
import time
import uuid
from collections import defaultdict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.exceptions import TooManyRequests
from app.core.rate_limit import limiter
from app.core.realtime import hub
from app.routers.deps import AuthUser
from app.services import call_service, contact_service, presence_service, push_service, session_service

log = logging.getLogger(__name__)
router = APIRouter(tags=["calls"])

MAX_SIGNAL_BYTES = 64 * 1024
RING_SECONDS = 45
# Call offers waiting for a callee who is offline (e.g. woken by a push notification).
_pending: dict[uuid.UUID, list[tuple[float, uuid.UUID, dict]]] = defaultdict(list)


@router.get("/api/v1/calls/ice-servers")
def ice_servers(user: AuthUser) -> dict:
    limiter.hit(f"ice:{user.id}", limit=60, window_seconds=600)
    return {"ice_servers": call_service.ice_servers()}


def _resolve(token: str | None):
    if not token or len(token) > 100:
        return None
    with SessionLocal() as db:
        return session_service.resolve(db, token)


def _blocked(recipient: uuid.UUID, sender: uuid.UUID) -> bool:
    with SessionLocal() as db:
        return contact_service.is_blocked(db, blocker_id=recipient, blocked_id=sender)


def _presence(viewer: uuid.UUID, target: uuid.UUID) -> dict:
    with SessionLocal() as db:
        return presence_service.payload(db, viewer, target, hub.is_online(target))


def _touch_last_seen(user_id: uuid.UUID) -> None:
    with SessionLocal() as db:
        presence_service.touch_last_seen(db, user_id)


async def _broadcast_presence(target: uuid.UUID) -> None:
    """Tell everyone watching `target` (in an open chat) that they came online / went offline."""
    for ws, watcher in hub.watchers_of(target):
        try:
            await ws.send_json(await asyncio.to_thread(_presence, watcher, target))
        except Exception:
            pass


_background: set[asyncio.Task] = set()


async def _went_offline(user_id: uuid.UUID) -> None:
    await asyncio.to_thread(_touch_last_seen, user_id)
    if not hub.is_online(user_id):  # they may have reconnected meanwhile
        await _broadcast_presence(user_id)


def _take_pending(user_id: uuid.UUID) -> list[dict]:
    now = time.monotonic()
    events = [e for t, _, e in _pending.pop(user_id, []) if now - t < RING_SECONDS]
    return events


@router.websocket("/api/v1/ws")
async def realtime(ws: WebSocket) -> None:
    origin = (ws.headers.get("origin") or "").rstrip("/")
    if origin not in settings.allowed_origins:  # blocks cross-site WebSocket hijacking
        await ws.close(code=4403)
        return
    user = await asyncio.to_thread(_resolve, ws.cookies.get(settings.cookie_name))
    if user is None:
        await ws.close(code=4401)
        return

    await ws.accept()
    if hub.add(user.id, ws):
        await _broadcast_presence(user.id)
    try:
        for event in _take_pending(user.id):  # ring for calls that started while we were offline
            await ws.send_json(event)
        while True:
            raw = await ws.receive_text()
            if len(raw) > MAX_SIGNAL_BYTES:
                await ws.send_json({"type": "error", "detail": "Message too large"})
                continue
            try:
                msg = json.loads(raw)
            except ValueError:
                continue
            await _handle(ws, user, msg)
    except WebSocketDisconnect:
        pass
    except Exception:
        log.exception("WebSocket error")
    finally:
        if hub.remove(user.id, ws):
            # Separate task: the handler itself may be cancelled while closing.
            task = asyncio.get_running_loop().create_task(_went_offline(user.id))
            _background.add(task)
            task.add_done_callback(_background.discard)


async def _handle(ws: WebSocket, user, msg: dict) -> None:
    kind = msg.get("type")
    if kind == "ping":
        await ws.send_json({"type": "pong"})
        return
    if kind in ("typing", "presence_watch", "presence_unwatch"):
        await _handle_status(ws, user, kind, msg)
        return
    if kind != "signal":
        return
    try:
        limiter.hit(f"signal:{user.id}", limit=600, window_seconds=60)
        to = uuid.UUID(str(msg.get("to")))
    except (TooManyRequests, ValueError):
        return
    payload, hint = msg.get("payload"), msg.get("hint")
    if not isinstance(payload, dict) or to == user.id:
        return
    if await asyncio.to_thread(_blocked, to, user.id):
        await ws.send_json({"type": "signal_failed", "to": str(to), "reason": "unavailable"})
        return

    event = {"type": "signal", "from": str(user.id), "from_name": user.username, "payload": payload}
    delivered = await hub.send(to, event)

    if hint == "offer":
        if delivered == 0:
            _pending[to].append((time.monotonic(), user.id, event))
        push_service.notify(to, {"type": "call", "from": user.username, "video": bool(msg.get("video")),
                                 "tag": f"call-{user.id}"}, ttl=RING_SECONDS, urgency="high")
        if delivered == 0 and not settings.push_enabled:
            await ws.send_json({"type": "signal_failed", "to": str(to), "reason": "offline"})
    elif hint == "end":
        _pending[to] = [p for p in _pending.get(to, []) if p[1] != user.id]
        if not _pending[to]:
            _pending.pop(to, None)


async def _handle_status(ws: WebSocket, user, kind: str, msg: dict) -> None:
    try:
        target = uuid.UUID(str(msg.get("to") or msg.get("user")))
        limiter.hit(f"status:{user.id}", limit=300, window_seconds=60)
    except (TooManyRequests, ValueError):
        return
    if target == user.id:
        return
    if kind == "presence_watch":
        hub.watch(user.id, ws, target)
        await ws.send_json(await asyncio.to_thread(_presence, user.id, target))
    elif kind == "presence_unwatch":
        hub.unwatch(ws, target)
    elif kind == "typing" and not await asyncio.to_thread(_blocked, target, user.id):
        await hub.send(target, {"type": "typing", "from": str(user.id), "state": bool(msg.get("state"))})
