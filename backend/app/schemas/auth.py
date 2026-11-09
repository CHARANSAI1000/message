from datetime import datetime
from typing import Annotated
from uuid import UUID

from pydantic import AfterValidator, BaseModel, Field, ValidationInfo, field_validator, model_validator

from app.schemas.common import normalize_email, normalize_username

Username = Annotated[str, Field(min_length=3, max_length=32), AfterValidator(normalize_username)]
Email = Annotated[str, Field(min_length=5, max_length=254), AfterValidator(normalize_email)]
NewPassword = Annotated[str, Field(min_length=12, max_length=128)]
Code = Annotated[str, Field(min_length=6, max_length=6, pattern=r"^\d{6}$")]


def _check_password(password: str, username: str = "") -> str:
    if username and username in password.lower():
        raise ValueError("Password must not contain your username")
    if len(set(password)) < 6:
        raise ValueError("Password is too repetitive")
    return password


class Registration(BaseModel):
    email: Email
    username: Username
    password: NewPassword

    @field_validator("password")
    @classmethod
    def strong_enough(cls, value: str, info: ValidationInfo) -> str:
        return _check_password(value, (info.data or {}).get("username", ""))


class Login(BaseModel):
    """`identifier` is a username or an email address."""

    identifier: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)

    @field_validator("identifier")
    @classmethod
    def normalize(cls, value: str) -> str:
        return value.strip().lower()


class EmailIn(BaseModel):
    email: Email


class CodeIn(BaseModel):
    email: Email
    code: Code


class PasswordResetIn(BaseModel):
    email: Email
    code: Code
    new_password: NewPassword

    @field_validator("new_password")
    @classmethod
    def strong_enough(cls, value: str) -> str:
        return _check_password(value)


class GoogleIn(BaseModel):
    credential: str = Field(min_length=20, max_length=4096)
    state: str = Field(min_length=10, max_length=100)
    username: Username | None = None  # required only the first time a Google account signs up


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: NewPassword


class AccountDelete(BaseModel):
    """Confirm with the password, or with an emailed code for accounts without a password."""

    password: str | None = Field(default=None, max_length=128)
    code: Code | None = None

    @model_validator(mode="after")
    def one_proof(self):
        if not self.password and not self.code:
            raise ValueError("Enter your password or the code we emailed you")
        return self


class PendingVerification(BaseModel):
    status: str = "verification_required"
    email: str


class Me(BaseModel):
    id: UUID
    username: str
    email: str | None
    email_verified: bool
    has_password: bool
    google_linked: bool
    avatar_version: int | None = None
    key_id: int | None


class AuthConfig(BaseModel):
    google: bool
    email_codes: bool
    push_public_key: str | None = None


class SessionInfo(BaseModel):
    id: UUID
    user_agent: str
    created_at: datetime
    last_seen_at: datetime
    current: bool


class UsernameChange(BaseModel):
    username: Username


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2048, pattern=r"^https://")
    p256dh: str = Field(min_length=10, max_length=200)
    auth: str = Field(min_length=10, max_length=100)
