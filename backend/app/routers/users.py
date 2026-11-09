from uuid import UUID

from fastapi import APIRouter, Query

from app.core.exceptions import NotFound
from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import UserOut
from app.schemas.common import normalize_username
from app.services import user_service

router = APIRouter(prefix="/api/v1/users", tags=["users"])


@router.get("/lookup", response_model=UserOut)
def lookup(user: AuthUser, db: DbSession, username: str = Query(min_length=3, max_length=32)) -> UserOut:
    limiter.hit(f"lookup:{user.id}", limit=30, window_seconds=60)
    try:
        username = normalize_username(username)
    except ValueError as exc:
        raise NotFound("User not found") from exc
    return UserOut.from_model(*user_service.get_by_username(db, username))


@router.get("/{user_id}", response_model=UserOut)
def get_user(user_id: UUID, user: AuthUser, db: DbSession) -> UserOut:
    return UserOut.from_model(*user_service.get_visible(db, user.id, user_id))
