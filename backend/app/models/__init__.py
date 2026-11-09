"""ORM models. Importing this package registers every table on Base.metadata (used by Alembic)."""

from app.models.auth_session import AuthSession
from app.models.base import Base
from app.models.block import Block
from app.models.contact import Contact
from app.models.email_code import EmailCode
from app.models.message import Message
from app.models.public_key import PublicKey
from app.models.user import User

__all__ = ["AuthSession", "Base", "Block", "Contact", "EmailCode", "Message", "PublicKey", "User"]
