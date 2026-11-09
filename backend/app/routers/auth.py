import hmac
import secrets
from uuid import UUID

from fastapi import APIRouter, Request, Response, status
from fastapi.responses import RedirectResponse

from app.core.config import settings
from app.core.exceptions import InvalidInput
from app.core.rate_limit import limiter
from app.core.security import client_ip
from app.models import User
from app.routers.deps import AuthUser, DbSession
from app.schemas import (
    AccountDelete, AuthConfig, CodeIn, EmailIn, GoogleIn, Login, Me, PasswordChange, PasswordResetIn,
    PendingVerification, Registration, SessionInfo,
)
from app.services import auth_service, google_service, key_service, session_service

router = APIRouter(prefix="/api/v1/auth", tags=["account"])


# ---------------------------------------------------------------- helpers
def _ua(request: Request) -> str:
    return request.headers.get("user-agent", "")


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.cookie_name, token,
        max_age=settings.session_absolute_days * 86400,
        httponly=True, secure=settings.is_production, samesite="strict", path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.cookie_name, path="/", secure=settings.is_production, httponly=True, samesite="strict")


def me_out(db: DbSession, user: User) -> Me:
    return Me(
        id=user.id, username=user.username, email=user.email, email_verified=user.email_verified,
        has_password=user.password_hash is not None, google_linked=user.google_sub is not None,
        avatar_version=user.avatar_version,
        key_id=key_service.current_key_id(db, user.id),
    )


def _signed_in(db: DbSession, response: Response, result: tuple[User, str]) -> Me:
    user, token = result
    _set_session_cookie(response, token)
    return me_out(db, user)


def _limit_code_requests(request: Request, email: str) -> None:
    limiter.hit(f"code-ip:{client_ip(request)}", limit=20, window_seconds=3600)
    limiter.hit(f"code-email:{email}", limit=5, window_seconds=900)


def _limit_code_checks(request: Request, email: str) -> None:
    limiter.hit(f"verify-ip:{client_ip(request)}", limit=30, window_seconds=900)
    limiter.hit(f"verify-email:{email}", limit=10, window_seconds=900)


# ---------------------------------------------------------------- public
@router.get("/config", response_model=AuthConfig)
def config() -> AuthConfig:
    return AuthConfig(google=bool(settings.google_client_id), email_codes=True,
                      push_public_key=settings.vapid_public_key if settings.push_enabled else None)


@router.post("/register", response_model=PendingVerification, status_code=status.HTTP_202_ACCEPTED)
def register(body: Registration, request: Request, db: DbSession) -> PendingVerification:
    limiter.hit(f"register:{client_ip(request)}", limit=10, window_seconds=3600)
    _limit_code_requests(request, body.email)
    return PendingVerification(email=auth_service.register(db, body.email, body.username, body.password))


@router.post("/verify-email", response_model=Me)
def verify_email(body: CodeIn, request: Request, response: Response, db: DbSession) -> Me:
    _limit_code_checks(request, body.email)
    return _signed_in(db, response, auth_service.verify_email(db, body.email, body.code, _ua(request)))


@router.post("/resend-verification", status_code=status.HTTP_202_ACCEPTED)
def resend_verification(body: EmailIn, request: Request, db: DbSession) -> dict[str, str]:
    _limit_code_requests(request, body.email)
    auth_service.resend_verification(db, body.email)
    return {"status": "sent"}


@router.post("/login", response_model=Me)
def login(body: Login, request: Request, response: Response, db: DbSession) -> Me:
    limiter.hit(f"login-ip:{client_ip(request)}", limit=20, window_seconds=900)
    limiter.hit(f"login-user:{body.identifier}", limit=10, window_seconds=900)
    return _signed_in(db, response, auth_service.login(db, body.identifier, body.password, _ua(request)))


@router.post("/code/request", status_code=status.HTTP_202_ACCEPTED)
def request_login_code(body: EmailIn, request: Request, db: DbSession) -> dict[str, str]:
    _limit_code_requests(request, body.email)
    auth_service.request_login_code(db, body.email)
    return {"status": "sent"}  # same answer whether or not the account exists


@router.post("/code/verify", response_model=Me)
def login_with_code(body: CodeIn, request: Request, response: Response, db: DbSession) -> Me:
    _limit_code_checks(request, body.email)
    return _signed_in(db, response, auth_service.login_with_code(db, body.email, body.code, _ua(request)))


@router.post("/password/forgot", status_code=status.HTTP_202_ACCEPTED)
def forgot_password(body: EmailIn, request: Request, db: DbSession) -> dict[str, str]:
    _limit_code_requests(request, body.email)
    auth_service.request_password_reset(db, body.email)
    return {"status": "sent"}


@router.post("/password/reset", response_model=Me)
def reset_password(body: PasswordResetIn, request: Request, response: Response, db: DbSession) -> Me:
    _limit_code_checks(request, body.email)
    result = auth_service.reset_password(db, body.email, body.code, body.new_password, _ua(request))
    return _signed_in(db, response, result)


OAUTH_COOKIE = "__Host-sm_oauth" if settings.is_production else "sm_oauth"


def _callback_uri(request: Request) -> str:
    """Return to the origin the user is on (e.g. Vite on :5173 in dev) if it's an allowed origin."""
    origin = f"{request.url.scheme}://{request.headers.get('host', '')}"
    base = origin if origin in settings.allowed_origins else settings.public_origin.rstrip("/")
    return base + google_service.CALLBACK_PATH


@router.get("/google/start")
def google_start(request: Request) -> RedirectResponse:
    limiter.hit(f"google-ip:{client_ip(request)}", limit=30, window_seconds=900)
    state, nonce = secrets.token_urlsafe(24), secrets.token_urlsafe(24)
    response = RedirectResponse(google_service.authorization_url(_callback_uri(request), state, nonce), status_code=302)
    response.set_cookie(OAUTH_COOKIE, f"{state}.{nonce}", max_age=600, httponly=True,
                        secure=settings.is_production, samesite="lax", path="/")
    return response


@router.post("/google", response_model=Me)
def google(body: GoogleIn, request: Request, response: Response, db: DbSession) -> Me:
    limiter.hit(f"google-ip:{client_ip(request)}", limit=30, window_seconds=900)
    stored = request.cookies.get(OAUTH_COOKIE, "")
    state, _, nonce = stored.partition(".")
    if not (state and nonce and hmac.compare_digest(state, body.state)):
        raise InvalidInput("Google sign-in expired. Please try again.", code="google_failed")
    identity = google_service.verify_id_token(body.credential, nonce)
    me = _signed_in(db, response, auth_service.google_sign_in(db, identity, body.username, _ua(request)))
    response.delete_cookie(OAUTH_COOKIE, path="/", secure=settings.is_production, httponly=True, samesite="lax")
    return me


# ---------------------------------------------------------------- signed in
@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, user: AuthUser, db: DbSession) -> None:
    auth_service.logout(db, user)
    _clear_session_cookie(response)


@router.get("/me", response_model=Me)
def me(user: AuthUser, db: DbSession) -> Me:
    return me_out(db, db.get_one(User, user.id))


@router.get("/sessions", response_model=list[SessionInfo])
def list_sessions(user: AuthUser, db: DbSession) -> list[SessionInfo]:
    return [
        SessionInfo(id=s.id, user_agent=s.user_agent, created_at=s.created_at, last_seen_at=s.last_seen_at,
                    current=s.id == user.session_id)
        for s in session_service.list_active(db, user.id)
    ]


@router.delete("/sessions/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_session(session_id: UUID, user: AuthUser, db: DbSession) -> None:
    session_service.revoke(db, user.id, session_id)


@router.post("/password", status_code=status.HTTP_204_NO_CONTENT)
def change_password(body: PasswordChange, user: AuthUser, db: DbSession) -> None:
    limiter.hit(f"password:{user.id}", limit=5, window_seconds=900)
    auth_service.change_password(db, user, body.current_password, body.new_password)


@router.post("/account/delete-code", status_code=status.HTTP_202_ACCEPTED)
def request_delete_code(request: Request, user: AuthUser, db: DbSession) -> dict[str, str]:
    limiter.hit(f"code-ip:{client_ip(request)}", limit=20, window_seconds=3600)
    limiter.hit(f"delete-code:{user.id}", limit=3, window_seconds=900)
    auth_service.request_delete_code(db, user)
    return {"status": "sent"}


@router.delete("/account", status_code=status.HTTP_204_NO_CONTENT)
def delete_account(body: AccountDelete, response: Response, user: AuthUser, db: DbSession) -> None:
    limiter.hit(f"password:{user.id}", limit=5, window_seconds=900)
    auth_service.delete_account(db, user, body.password, body.code)
    _clear_session_cookie(response)
