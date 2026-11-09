"""Domain errors raised by services. One handler turns them into JSON responses."""

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    status_code = 400

    def __init__(self, detail: str, *, code: str | None = None, extra: dict | None = None,
                 headers: dict[str, str] | None = None) -> None:
        super().__init__(detail)
        self.detail = detail
        self.code = code  # machine-readable reason the client can branch on
        self.extra = extra or {}
        self.headers = headers


class Unauthorized(AppError):
    status_code = 401


class Forbidden(AppError):
    status_code = 403


class NotFound(AppError):
    status_code = 404


class Conflict(AppError):
    status_code = 409


class PayloadTooLarge(AppError):
    status_code = 413


class InvalidInput(AppError):
    status_code = 422


class TooManyRequests(AppError):
    status_code = 429


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_request: Request, exc: AppError) -> JSONResponse:
        body = {"detail": exc.detail, **({"code": exc.code} if exc.code else {}), **exc.extra}
        return JSONResponse(body, status_code=exc.status_code, headers=exc.headers)
