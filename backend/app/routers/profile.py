from uuid import UUID

from fastapi import APIRouter, Request, Response, status

from app.core.rate_limit import limiter
from app.routers.auth import me_out
from app.routers.deps import AuthUser, DbSession
from app.models import User
from app.schemas import Me, PrivacyIn, UsernameChange
from app.services import profile_service, user_service

router = APIRouter(prefix="/api/v1", tags=["profile"])


@router.patch("/me", response_model=Me)
def change_username(body: UsernameChange, user: AuthUser, db: DbSession) -> Me:
    limiter.hit(f"rename:{user.id}", limit=5, window_seconds=3600)
    return me_out(db, profile_service.change_username(db, user.id, body.username))


@router.put("/me/avatar", response_model=Me)
async def upload_avatar(request: Request, user: AuthUser, db: DbSession) -> Me:
    limiter.hit(f"avatar:{user.id}", limit=10, window_seconds=3600)
    data = await request.body()
    return me_out(db, profile_service.set_avatar(db, user.id, data))


@router.delete("/me/avatar", status_code=status.HTTP_204_NO_CONTENT)
def delete_avatar(user: AuthUser, db: DbSession) -> None:
    profile_service.remove_avatar(db, user.id)


@router.get("/users/{user_id}/avatar")
def get_avatar(user_id: UUID, user: AuthUser, db: DbSession) -> Response:
    user_service.get_visible(db, user.id, user_id)  # same visibility rule as the profile
    data, mime = profile_service.get_avatar(db, user_id)
    return Response(data, media_type=mime, headers={"cache-control": "private, max-age=86400"})




@router.patch("/me/privacy", response_model=Me)
def update_privacy(body: PrivacyIn, user: AuthUser, db: DbSession) -> Me:
    me = db.get_one(User, user.id)
    for field in ("show_presence", "read_receipts", "discoverable"):
        value = getattr(body, field)
        if value is not None:
            setattr(me, field, value)
    db.commit()
    return me_out(db, me)
