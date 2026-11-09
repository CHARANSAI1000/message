"""ORM models. Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.attachment import Attachment
from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.block import Block
from app.models.contact import Contact
from app.models.email_code import EmailCode
from app.models.message import Message, message_rev_seq
from app.models.public_key import PublicKey
from app.models.push_subscription import PushSubscription
from app.models.user import User

__all__ = ["Attachment", "AuthSession", "Base", "Block", "Contact", "EmailCode", "Message", "PublicKey", "PushSubscription", "User", "message_rev_seq"]
