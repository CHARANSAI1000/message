from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, field_validator

from app.schemas.common import B64Bytes

ALLOWED_TTLS = {None, 300, 3600, 86400, 604800}


class MessageIn(BaseModel):
    id: UUID
    recipient_id: UUID
    sender_key_id: int
    recipient_key_id: int
    iv: B64Bytes
    ciphertext: B64Bytes
    ttl_seconds: int | None = None
    attachment_id: UUID | None = None

    @field_validator("iv")
    @classmethod
    def iv_size(cls, value: bytes) -> bytes:
        if len(value) != 12:
            raise ValueError("IV must be 12 bytes")
        return value

    @field_validator("ttl_seconds")
    @classmethod
    def ttl_allowed(cls, value: int | None) -> int | None:
        if value not in ALLOWED_TTLS:
            raise ValueError("Unsupported disappearing-message timer")
        return value


class MessageEdit(BaseModel):
    iv: B64Bytes
    ciphertext: B64Bytes

    @field_validator("iv")
    @classmethod
    def iv_size(cls, value: bytes) -> bytes:
        if len(value) != 12:
            raise ValueError("IV must be 12 bytes")
        return value


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    rev: int
    id: UUID
    sender_id: UUID
    recipient_id: UUID
    sender_key_id: int
    recipient_key_id: int
    iv: B64Bytes
    ciphertext: B64Bytes
    ttl_seconds: int | None
    attachment_id: UUID | None
    created_at: datetime
    edited_at: datetime | None
    delivered_at: datetime | None
    read_at: datetime | None
    deleted: bool
    expires_at: datetime


class SyncOut(BaseModel):
    messages: list[MessageOut]
    has_more: bool


class ReadReceiptIn(BaseModel):
    peer_id: UUID
    up_to_seq: int
