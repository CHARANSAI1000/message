import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import Scope

from app.core.config import settings
from app.core.database import engine, run_migrations
from app.core.exceptions import register_exception_handlers
from app.core.middleware import SecurityMiddleware
from app.core.realtime import hub
from app.routers import all_routers
from app.services.maintenance_service import cleanup_expired

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
log = logging.getLogger("app")


async def _cleanup_loop() -> None:
    if settings.cleanup_interval_seconds <= 0:
        return
    while True:
        try:
            await asyncio.to_thread(cleanup_expired)
        except Exception:  # never log message contents; only the failure
            log.exception("Cleanup failed")
        await asyncio.sleep(settings.cleanup_interval_seconds)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await asyncio.to_thread(run_migrations)
    hub.bind_loop(asyncio.get_running_loop())
    task = asyncio.create_task(_cleanup_loop())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
        engine.dispose()


app = FastAPI(
    title="ForYou API",
    version="0.3.0",
    lifespan=lifespan,
    docs_url=None if settings.is_production else "/docs",
    redoc_url=None,
    openapi_url=None if settings.is_production else "/openapi.json",
)
app.add_middleware(SecurityMiddleware)
register_exception_handlers(app)
for router in all_routers:
    app.include_router(router)


class SPAStaticFiles(StaticFiles):
    """Serve the built React app; unknown non-API paths fall back to index.html."""

    async def get_response(self, path: str, scope: Scope):
        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != 404 or path.startswith("api/"):
                raise
            response = await super().get_response("index.html", scope)
        response.headers["cache-control"] = (
            "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        )
        return response


if (settings.static_dir / "index.html").is_file():
    app.mount("/", SPAStaticFiles(directory=settings.static_dir, html=True), name="web")
else:
    log.info("No built web client at %s; serving API only", settings.static_dir)
