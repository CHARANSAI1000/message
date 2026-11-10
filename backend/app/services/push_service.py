"""Web Push (VAPID) so phones/computers can ring and notify while ForYou is closed.

Payloads are encrypted for the browser (RFC 8291) and contain no message text — only who and what kind.
"""

import json
import logging
import uuid
from concurrent.futures import ThreadPoolExecutor

from py_vapid import Vapid
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import SessionLocal
from app.models import PushSubscription

log = logging.getLogger(__name__)
_pool = ThreadPoolExecutor(max_workers=2, thread_name_prefix="push")
_vapid: Vapid | None = None


def _get_vapid() -> Vapid:
    global _vapid
    if _vapid is None:
        _vapid = Vapid.from_raw(settings.vapid_private_key.encode())
    return _vapid


def subscribe(db: Session, user_id: uuid.UUID, endpoint: str, p256dh: str, auth: str) -> None:
    db.execute(
        insert(PushSubscription)
        .values(user_id=user_id, endpoint=endpoint, p256dh=p256dh, auth=auth)
        .on_conflict_do_update(index_elements=["endpoint"], set_={"user_id": user_id, "p256dh": p256dh, "auth": auth})
    )
    db.commit()


def unsubscribe(db: Session, user_id: uuid.UUID, endpoint: str) -> None:
    db.execute(delete(PushSubscription).where(PushSubscription.user_id == user_id, PushSubscription.endpoint == endpoint))
    db.commit()


def _deliver(user_id: uuid.UUID, payload: dict, ttl: int, urgency: str) -> None:
    with SessionLocal() as db:
        subs = list(db.scalars(select(PushSubscription).where(PushSubscription.user_id == user_id)))
        for sub in subs:
            try:
                webpush(
                    subscription_info={"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                    data=json.dumps(payload),
                    vapid_private_key=_get_vapid(),
                    vapid_claims={"sub": settings.vapid_subject},
                    ttl=ttl,
                    headers={"Urgency": urgency},
                    timeout=10,
                )
            except WebPushException as exc:
                status = getattr(exc.response, "status_code", None)
                if status in (404, 410):  # subscription expired or revoked
                    db.delete(sub)
                    db.commit()
                else:
                    log.warning("Push delivery failed (HTTP %s)", status)
            except Exception:
                log.exception("Push delivery failed")


def notify(user_id: uuid.UUID, payload: dict, *, ttl: int = 3600, urgency: str = "normal") -> None:
    """Browser push (Web Push) and installed-app push (FCM), whichever are configured."""
    if settings.push_enabled:
        _pool.submit(_deliver, user_id, payload, ttl, urgency)
    from app.services import fcm_service
    if fcm_service.enabled():
        _pool.submit(fcm_service.send, user_id, payload)
