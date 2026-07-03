from typing import Optional

from langchain_core.tools import tool
from app.services.db_service import db_service

_ADMIN_TYPES = {"postgresql", "mysql", "mariadb", "mssql", "cockroachdb", "snowflake", "oracle"}


def make_admin_tools(conn, propose_only: bool = False, plan_sink: Optional[list] = None):
    """Return admin tools bound to a specific DbConnection. Only wired for SQL servers that support it.

    Note: create_db_user is intentionally NOT exposed here — it issues GRANT/CREATE USER
    statements, and user-permission changes must never be reachable through the AI agent.
    The underlying db_service.create_db_user method is still used by the UI/admin-only path."""
    if conn.db_type not in _ADMIN_TYPES:
        return []

    @tool
    def create_database(db_name: str) -> str:
        """Create a new database on the connected server. Not supported for Oracle (no SQL-level CREATE DATABASE)."""
        if propose_only:
            if plan_sink is not None:
                plan_sink.append({"tool": "create_database", "db_name": db_name})
            return f"PLANNED (awaiting user approval, not yet executed): create database '{db_name}'"
        try:
            db_service.create_database(conn, db_name)
            return f"Database '{db_name}' created successfully."
        except Exception as e:
            return f"ERROR: {e}"

    return [create_database]
