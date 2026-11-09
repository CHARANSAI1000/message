from fastapi import APIRouter, status

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import PublicKeyIn, PublicKeyOut
from app.services import key_service

router = APIRouter(prefix="/api/v1/keys", tags=["keys"])


@router.post("", response_model=PublicKeyOut, status_code=status.HTTP_201_CREATED)
def upload_key(body: PublicKeyIn, user: AuthUser, db: DbSession) -> PublicKeyOut:
    limiter.hit(f"keys:{user.id}", limit=5, window_seconds=3600)
    return PublicKeyOut.from_model(key_service.upload(db, user.id, body.spki))


@router.get("/{key_id}", response_model=PublicKeyOut)
def get_key(key_id: int, _user: AuthUser, db: DbSession) -> PublicKeyOut:
    return PublicKeyOut.from_model(key_service.get(db, key_id))
