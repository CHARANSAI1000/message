from uuid import UUID

from pydantic import BaseModel, field_validator

from app.models import PublicKey
from app.schemas.common import B64Bytes


class PublicKeyIn(BaseModel):
    spki: B64Bytes

    @field_validator("spki")
    @classmethod
    def size(cls, value: bytes) -> bytes:
        if not 64 <= len(value) <= 200:
            raise ValueError("Unexpected public key size")
        return value


class PublicKeyOut(BaseModel):
    key_id: int
    user_id: UUID
    spki: B64Bytes

    @classmethod
    def from_model(cls, key: PublicKey) -> "PublicKeyOut":
        return cls(key_id=key.id, user_id=key.user_id, spki=key.spki)
