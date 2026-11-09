from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import PushSubscriptionIn
from app.services import push_service

router = APIRouter(prefix="/api/v1/push", tags=["notifications"])


class EndpointIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048)


@router.post("/subscribe", status_code=status.HTTP_204_NO_CONTENT)
def subscribe(body: PushSubscriptionIn, user: AuthUser, db: DbSession) -> None:
    limiter.hit(f"push:{user.id}", limit=20, window_seconds=3600)
    push_service.subscribe(db, user.id, body.endpoint, body.p256dh, body.auth)


@router.post("/unsubscribe", status_code=status.HTTP_204_NO_CONTENT)
def unsubscribe(body: EndpointIn, user: AuthUser, db: DbSession) -> None:
    push_service.unsubscribe(db, user.id, body.endpoint)
