"""Shared FastAPI dependencies."""

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.exceptions import Unauthorized
from app.services import session_service
from app.services.session_service import CurrentUser

DbSession = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: DbSession) -> CurrentUser:
    token = request.cookies.get(settings.cookie_name)
    if not token or len(token) > 100:
        raise Unauthorized("Not signed in")
    user = session_service.resolve(db, token)
    if user is None:
        raise Unauthorized("Not signed in")
    return user


AuthUser = Annotated[CurrentUser, Depends(current_user)]
