from uuid import UUID

from fastapi import APIRouter, Query, status

from app.core.realtime import hub

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.models import User
from app.schemas import MessageEdit, MessageIn, MessageOut, ReadReceiptIn, SyncOut
from app.services import message_service, push_service

router = APIRouter(prefix="/api/v1/messages", tags=["messages"])


@router.post("", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
def send_message(body: MessageIn, user: AuthUser, db: DbSession) -> MessageOut:
    limiter.hit(f"send:{user.id}", limit=60, window_seconds=60)
    message = message_service.send(db, user.id, body)
    hub.notify([user.id, message.recipient_id], {"type": "sync"})
    push_service.notify(message.recipient_id, {"type": "message", "from": user.username, "tag": f"chat-{user.id}"})
    return MessageOut.model_validate(message)


@router.put("/{message_id}", response_model=MessageOut)
def edit_message(message_id: UUID, body: MessageEdit, user: AuthUser, db: DbSession) -> MessageOut:
    limiter.hit(f"send:{user.id}", limit=60, window_seconds=60)
    message = message_service.edit(db, user.id, message_id, body)
    hub.notify([user.id, message.recipient_id], {"type": "sync"})
    return MessageOut.model_validate(message)


@router.delete("/{message_id}", response_model=MessageOut)
def delete_message(message_id: UUID, user: AuthUser, db: DbSession) -> MessageOut:
    """Delete for everyone (sender only). "Delete for me" is handled on the device."""
    message = message_service.delete_for_everyone(db, user.id, message_id)
    hub.notify([user.id, message.recipient_id], {"type": "sync"})
    return MessageOut.model_validate(message)


@router.get("/sync", response_model=SyncOut)
def sync(user: AuthUser, db: DbSession,
         after: int = Query(0, ge=0), limit: int = Query(200, ge=1, le=500)) -> SyncOut:
    """New, edited, deleted and receipt-updated envelopes. Fetching marks incoming messages delivered."""
    limiter.hit(f"sync:{user.id}", limit=180, window_seconds=60)
    senders = message_service.mark_delivered(db, user.id)
    if senders:
        hub.notify(list(senders), {"type": "sync"})
    messages, has_more = message_service.sync(db, user.id, after, limit)
    shows_receipts = db.get_one(User, user.id).read_receipts
    out = []
    for m in messages:
        item = MessageOut.model_validate(m)
        if not shows_receipts:  # reciprocal: hide others' blue ticks if you hide yours
            item.read_at = None
        out.append(item)
    return SyncOut(messages=out, has_more=has_more)


@router.post("/read", status_code=status.HTTP_204_NO_CONTENT)
def mark_read(body: ReadReceiptIn, user: AuthUser, db: DbSession) -> None:
    """The reader opened the chat with `peer_id`. Nothing is recorded if they turned read receipts off."""
    limiter.hit(f"read:{user.id}", limit=240, window_seconds=60)
    if db.get_one(User, user.id).read_receipts and message_service.mark_read(db, user.id, body.peer_id, body.up_to_seq):
        hub.notify([body.peer_id, user.id], {"type": "sync"})
