from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from pydantic import BaseModel

from app.core.exceptions import InvalidInput
from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.services import attachment_service

router = APIRouter(prefix="/api/v1/attachments", tags=["media"])


class AttachmentOut(BaseModel):
    id: UUID
    size: int


@router.post("", response_model=AttachmentOut, status_code=status.HTTP_201_CREATED)
async def upload(request: Request, user: AuthUser, db: DbSession) -> AttachmentOut:
    """Body: the client-encrypted bytes (application/octet-stream). The server never sees the key."""
    limiter.hit(f"upload:{user.id}", limit=60, window_seconds=600)
    if request.headers.get("content-type", "").split(";")[0] != "application/octet-stream":
        raise InvalidInput("Upload encrypted bytes as application/octet-stream")
    att = attachment_service.upload(db, user.id, await request.body())
    return AttachmentOut(id=att.id, size=att.size)


@router.get("/{attachment_id}")
def download(attachment_id: UUID, user: AuthUser, db: DbSession) -> Response:
    limiter.hit(f"download:{user.id}", limit=600, window_seconds=600)
    data = attachment_service.download(db, user.id, attachment_id)
    return Response(data, media_type="application/octet-stream",
                    headers={"cache-control": "private, max-age=86400", "content-disposition": "attachment"})
