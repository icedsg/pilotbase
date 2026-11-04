"""Query history uses a sync engine, so the desktop app's async SQLite URL has to be turned into a sync one."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ENCRYPTION_KEY", "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=")

from app.services.history_service import _sync_url  # noqa: E402


def test_desktop_sqlite_url_becomes_sync():
    assert _sync_url("sqlite+aiosqlite:///C:/data/pilotbase.db") == "sqlite:///C:/data/pilotbase.db"


def test_docker_postgres_url_is_left_alone():
    url = "postgresql+psycopg2://u:p@db:5432/pilotbase"
    assert _sync_url(url) == url
