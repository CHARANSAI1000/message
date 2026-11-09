"""Sign in with Google via the OpenID Connect redirect flow (no Google JavaScript on our pages).

1. /auth/google/start sends the browser to Google with a random `state` and `nonce`
   (both also stored in a short-lived HttpOnly cookie).
2. Google redirects back to /auth/google/callback#id_token=…&state=…
3. The web app posts the ID token + state; we check state, the token signature (Google JWKS),
   audience, issuer, expiry, nonce and email_verified.
"""

from dataclasses import dataclass
from urllib.parse import urlencode

import jwt
from jwt import PyJWKClient

from app.core.config import settings
from app.core.exceptions import InvalidInput, Unauthorized

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs"
GOOGLE_ISSUERS = ("accounts.google.com", "https://accounts.google.com")
CALLBACK_PATH = "/auth/google/callback"
_jwks = PyJWKClient(GOOGLE_CERTS_URL, cache_keys=True, lifespan=3600, timeout=10)


@dataclass(frozen=True)
class GoogleIdentity:
    sub: str
    email: str
    name: str


def authorization_url(redirect_uri: str, state: str, nonce: str) -> str:
    if not settings.google_client_id:
        raise InvalidInput("Google sign-in is not configured")
    return GOOGLE_AUTH_URL + "?" + urlencode({
        "client_id": settings.google_client_id,
        "redirect_uri": redirect_uri,
        "response_type": "id_token",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "prompt": "select_account",
    })


def verify_id_token(credential: str, nonce: str) -> GoogleIdentity:
    if not settings.google_client_id:
        raise InvalidInput("Google sign-in is not configured")
    try:
        key = _jwks.get_signing_key_from_jwt(credential)
        claims = jwt.decode(
            credential, key.key, algorithms=["RS256"], audience=settings.google_client_id,
            issuer=GOOGLE_ISSUERS, options={"require": ["exp", "iat", "sub", "aud", "iss", "nonce"]}, leeway=30,
        )
    except jwt.PyJWTError as exc:
        raise Unauthorized("Google sign-in failed. Please try again.", code="google_failed") from exc
    if claims.get("nonce") != nonce:
        raise Unauthorized("Google sign-in expired. Please try again.", code="google_failed")
    if not claims.get("email") or claims.get("email_verified") is not True:
        raise Unauthorized("Your Google account has no verified email address.", code="google_failed")
    return GoogleIdentity(sub=str(claims["sub"]), email=str(claims["email"]).lower(), name=str(claims.get("name", "")))
