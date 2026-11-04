import os
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ENCRYPTION_KEY", "Zm9vYmFyYmF6cXV4Zm9vYmFyYmF6cXV4Zm9vYmFyYmE=")

from app.database import Base  # noqa: E402
from app.models import connection, saved_query, user  # noqa: E402,F401


def test_saved_queries_schema_builds_on_sqlite():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("saved_queries")}
    assert columns == {"id", "user_id", "connection_id", "name", "query_text", "created_at", "updated_at"}


def test_saved_queries_schema_builds_on_postgresql_ddl():
    from sqlalchemy.dialects import postgresql
    from sqlalchemy.schema import CreateTable

    ddl = str(CreateTable(saved_query.SavedQuery.__table__).compile(dialect=postgresql.dialect()))
    assert "saved_queries" in ddl and "query_text TEXT NOT NULL" in ddl
