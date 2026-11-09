"""SQLAlchemy engine, session factory, request-scoped session dependency and migrations."""

from collections.abc import Iterator
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[2]
MIGRATION_LOCK_ID = 727_001


def _sqlalchemy_url(url: str) -> str:
    # Accept plain postgres URLs (as Neon/Render give them) and use the psycopg 3 driver.
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


engine = create_engine(
    _sqlalchemy_url(settings.database_url),
    pool_size=settings.db_pool_max,
    max_overflow=0,
    pool_pre_ping=True,  # free databases drop idle connections
    pool_recycle=300,
    # prepare_threshold=None keeps it compatible with PgBouncer-style poolers (Neon, Supabase).
    connect_args={"prepare_threshold": None, "connect_timeout": 10},
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    """FastAPI dependency: one session per request. Services commit explicitly."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def run_migrations() -> None:
    """Apply Alembic migrations to head, serialised by an advisory lock (safe with several instances)."""
    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "migrations"))
    with engine.begin() as connection:
        connection.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": MIGRATION_LOCK_ID})
        cfg.attributes["connection"] = connection
        command.upgrade(cfg, "head")
