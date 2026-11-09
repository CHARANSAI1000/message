"""In-memory WebSocket hub: one process, many connections per user (tabs, devices).

Events carry no message content — {"type": "sync"} tells a client to fetch encrypted envelopes,
and call signalling payloads are end-to-end encrypted by the clients.
"""

import asyncio
import logging
import uuid
from collections import defaultdict
from typing import Any

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self) -> None:
        self._conns: dict[uuid.UUID, set[WebSocket]] = defaultdict(set)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def add(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        self._conns[user_id].add(ws)

    def remove(self, user_id: uuid.UUID, ws: WebSocket) -> None:
        conns = self._conns.get(user_id)
        if conns:
            conns.discard(ws)
            if not conns:
                del self._conns[user_id]

    def is_online(self, user_id: uuid.UUID) -> bool:
        return bool(self._conns.get(user_id))

    async def send(self, user_id: uuid.UUID, event: dict[str, Any], *, exclude: WebSocket | None = None) -> int:
        delivered = 0
        for ws in list(self._conns.get(user_id, ())):
            if ws is exclude:
                continue
            try:
                await ws.send_json(event)
                delivered += 1
            except Exception:  # connection is closing; its handler will clean up
                self.remove(user_id, ws)
        return delivered

    def notify(self, user_ids: list[uuid.UUID], event: dict[str, Any]) -> None:
        """Fire-and-forget from synchronous (threadpool) code."""
        if self._loop is None or self._loop.is_closed():
            return
        for uid in set(user_ids):
            if uid in self._conns:
                asyncio.run_coroutine_threadsafe(self.send(uid, event), self._loop)


hub = Hub()
