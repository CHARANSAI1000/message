from pathlib import Path

from app.core.config import settings

BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_static_dir_points_at_backend_static():
    # Docker copies the built web app to /app/static, i.e. <backend>/static.
    assert settings.static_dir == BACKEND_DIR / "static"
