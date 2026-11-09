from fastapi import APIRouter, Query, status

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import MessageIn, MessageOut, SyncOut
from app.services import message_service

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])


@router.post("", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(body: MessageIn, user: AuthUser, db: DbSession) -> MessageOut:
    limiter.hit(f"send:{user.id}", limit=60, window_seconds=60)
    return MessageOut.model_validate(message_service.send(db, user.id, body))


@router.get("/sync", response_model=SyncOut)
def sync(user: AuthUser, db: DbSession,
         after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)) -> SyncOut:
    limiter.hit(f"sync:{user.id}", limit=180, window_seconds=60)
    messages, has_more = message_service.sync(db, user.id, after, limit)
    return SyncOut(messages=[MessageOut.model_validate(m) for m in messages], has_more=has_more)
