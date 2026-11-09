from uuid import UUID

from fastapi import APIRouter, status

from app.core.rate_limit import limiter
from app.routers.deps import AuthUser, DbSession
from app.schemas import UserOut, UsernameIn
from app.services import contact_service

router = APIRouter(prefix="/api/v1", tags=["contacts"])


@router.get("/contacts", response_model=list[UserOut])
def list_contacts(user: AuthUser, db: DbSession) -> list[UserOut]:
    return [UserOut.from_model(u, k) for u, k in contact_service.list_contacts(db, user.id)]


@router.post("/contacts", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def add_contact(body: UsernameIn, user: AuthUser, db: DbSession) -> UserOut:
    limiter.hit(f"lookup:{user.id}", limit=30, window_seconds=60)
    return UserOut.from_model(*contact_service.add_contact(db, user.id, body.username))


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_contact(contact_id: UUID, user: AuthUser, db: DbSession) -> None:
    contact_service.remove_contact(db, user.id, contact_id)


@router.get("/blocks", response_model=list[UUID])
def list_blocks(user: AuthUser, db: DbSession) -> list[UUID]:
    return contact_service.list_blocked_ids(db, user.id)


@router.put("/blocks/{blocked_id}", status_code=status.HTTP_204_NO_CONTENT)
def block(blocked_id: UUID, user: AuthUser, db: DbSession) -> None:
    contact_service.block(db, user.id, blocked_id)


@router.delete("/blocks/{blocked_id}", status_code=status.HTTP_204_NO_CONTENT)
def unblock(blocked_id: UUID, user: AuthUser, db: DbSession) -> None:
    contact_service.unblock(db, user.id, blocked_id)
