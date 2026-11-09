from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.models import PublicKey, User
from app.schemas.common import normalize_username
from app.schemas.key import PublicKeyOut


class UserOut(BaseModel):
    """Public profile: never includes the password hash."""

    id: UUID
    username: str
    key: PublicKeyOut | None

    @classmethod
    def from_model(cls, user: User, key: PublicKey | None) -> "UserOut":
        return cls(id=user.id, username=user.username, key=PublicKeyOut.from_model(key) if key else None)


class UsernameIn(BaseModel):
    username: str = Field(min_length=3, max_length=32)

    @field_validator("username")
    @classmethod
    def normalize(cls, value: str) -> str:
        return normalize_username(value)
