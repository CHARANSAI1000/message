from fastapi import APIRouter, HTTPException
from sqlalchemy import text

from app.routers.deps import DbSession

router = APIRouter(tags=["operations"])


@router.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/readyz")
def readiness(db: DbSession) -> dict[str, str]:
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:
        raise HTTPException(503, "Database unavailable") from exc
    return {"status": "ready"}
