"""In-memory sliding-window rate limiter. Correct for a single instance (free tier)."""

import threading
import time
from collections import defaultdict, deque

from app.core.exceptions import TooManyRequests


class RateLimiter:
    def __init__(self) -> None:
        self._hits: dict[str, deque[float]] = defaultdict(deque)
        self._lock = threading.Lock()
        self._last_sweep = time.monotonic()

    def hit(self, key: str, limit: int, window_seconds: float) -> None:
        now = time.monotonic()
        with self._lock:
            if now - self._last_sweep > 300:
                self._sweep(now)
            bucket = self._hits[key]
            while bucket and now - bucket[0] > window_seconds:
                bucket.popleft()
            if len(bucket) >= limit:
                retry = int(window_seconds - (now - bucket[0])) + 1
                raise TooManyRequests("Too many requests. Try again later.", headers={"Retry-After": str(retry)})
            bucket.append(now)

    def _sweep(self, now: float) -> None:
        self._last_sweep = now
        for key in [k for k, b in self._hits.items() if not b or now - b[-1] > 3600]:
            del self._hits[key]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


limiter = RateLimiter()
