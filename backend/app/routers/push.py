from fastapi import APIRouter, status
from pydantic import BaseModel, Field

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import DeviceTokenIn, PushSubscriptionIn
from app.services import fcm_service, push_service

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


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=4096)


@router.post("/device", status_code=status.HTTP_204_NO_CONTENT)
def register_device(body: DeviceTokenIn, user: AuthUser) -> None:
    """Firebase token from the installed Android/iPhone app."""
    limiter.hit(f"push:{user.id}", limit=20, window_seconds=3600)
    fcm_service.register(user.id, body.token, body.platform)


@router.post("/device/remove", status_code=status.HTTP_204_NO_CONTENT)
def unregister_device(body: TokenIn, user: AuthUser) -> None:
    fcm_service.unregister(user.id, body.token)
