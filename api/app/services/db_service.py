"""
Manages live connections to external databases registered by users.
Uses SQLAlchemy with synchronous engines (connection is per-request, pooled).
"""
import json
from typing import Any, Dict, List, Optional

from cryptography.fernet import Fernet
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

from app.config import settings
from app.models.connection import DbConnection


class DatabaseService:
    def __init__(self):
        self._engines: Dict[str, Engine] = {}
        self._cipher = Fernet(settings.encryption_key.encode())

    # ── Encryption helpers ────────────────────────────────────────────────────

    def encrypt_password(self, password: str) -> str:
        return self._cipher.encrypt(password.encode()).decode()

    def decrypt_password(self, encrypted: str) -> str:
        return self._cipher.decrypt(encrypted.encode()).decode()

    # ── Connection URL building ───────────────────────────────────────────────

    def build_url(self, conn: DbConnection) -> str:
        password = self.decrypt_password(conn.password_encrypted) if conn.password_encrypted else ""
        extra = json.loads(conn.extra_params) if conn.extra_params else {}

        drivers = {
            "postgresql": "postgresql+psycopg2",
            "mysql":      "mysql+pymysql",
            "mariadb":    "mysql+pymysql",
            "sqlite":     "sqlite",
            "mssql":      "mssql+pyodbc",
        }
        driver = drivers.get(conn.db_type, conn.db_type)

        if conn.db_type == "sqlite":
            return f"sqlite:///{conn.database}"

        host_port = f"{conn.host}:{conn.port}" if conn.port else conn.host
        db_part = f"/{conn.database}" if conn.database else ""
        return f"{driver}://{conn.username}:{password}@{host_port}{db_part}"

    # ── Engine lifecycle ──────────────────────────────────────────────────────

    def get_engine(self, conn: DbConnection) -> Engine:
        if conn.id not in self._engines:
            url = self.build_url(conn)
            self._engines[conn.id] = create_engine(url, pool_pre_ping=True, pool_size=3, max_overflow=5)
        return self._engines[conn.id]

    def drop_engine(self, connection_id: str) -> None:
        if connection_id in self._engines:
            self._engines[connection_id].dispose()
            del self._engines[connection_id]

    # ── Metadata ──────────────────────────────────────────────────────────────

    def test_connection(self, conn: DbConnection) -> bool:
        try:
            engine = self.get_engine(conn)
            with engine.connect() as c:
                c.execute(text("SELECT 1"))
            return True
        except Exception:
            return False

    def list_databases(self, conn: DbConnection) -> List[str]:
        engine = self.get_engine(conn)
        with engine.connect() as c:
            if conn.db_type == "postgresql":
                rows = c.execute(text("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname"))
                return [r[0] for r in rows]
            if conn.db_type in ("mysql", "mariadb"):
                rows = c.execute(text("SHOW DATABASES"))
                return [r[0] for r in rows]
        return [conn.database or "main"]

    def list_schemas(self, conn: DbConnection) -> List[str]:
        engine = self.get_engine(conn)
        inspector = inspect(engine)
        return inspector.get_schema_names()

    def list_objects(self, conn: DbConnection, schema: Optional[str] = None) -> List[Dict]:
        engine = self.get_engine(conn)
        inspector = inspect(engine)
        tables = [{"name": t, "type": "table"} for t in inspector.get_table_names(schema=schema)]
        views  = [{"name": v, "type": "view"}  for v in inspector.get_view_names(schema=schema)]
        return tables + views

    def describe_table(self, conn: DbConnection, table: str, schema: Optional[str] = None) -> Dict[str, Any]:
        engine = self.get_engine(conn)
        inspector = inspect(engine)
        return {
            "columns":      [{"name": c["name"], "type": str(c["type"]), "nullable": c.get("nullable", True), "default": str(c.get("server_default") or "")} for c in inspector.get_columns(table, schema=schema)],
            "primary_keys": inspector.get_pk_constraint(table, schema=schema).get("constrained_columns", []),
            "foreign_keys": inspector.get_foreign_keys(table, schema=schema),
            "indexes":      inspector.get_indexes(table, schema=schema),
        }

    # ── Query execution ───────────────────────────────────────────────────────

    def execute_query(
        self,
        conn: DbConnection,
        query: str,
        params: Optional[Dict] = None,
        limit: int = 1000,
    ) -> Dict[str, Any]:
        engine = self.get_engine(conn)
        with engine.begin() as c:
            result = c.execute(text(query), params or {})
            if result.returns_rows:
                rows = [dict(row._mapping) for row in result.fetchmany(limit)]
                return {
                    "rows": rows,
                    "columns": list(result.keys()),
                    "row_count": len(rows),
                    "truncated": len(rows) == limit,
                }
            return {
                "rows": [],
                "columns": [],
                "row_count": result.rowcount,
                "affected": result.rowcount,
            }


db_service = DatabaseService()
