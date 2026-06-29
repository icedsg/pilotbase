from langchain_core.tools import tool
from app.services.db_service import db_service

_ADMIN_TYPES = {"postgresql", "mysql", "mariadb"}


def make_admin_tools(conn):
    """Return admin tools bound to a specific DbConnection. Only wired for SQL servers that support it."""
    if conn.db_type not in _ADMIN_TYPES:
        return []

    @tool
    def create_database(db_name: str) -> str:
        """Create a new database on the connected server. Supported for PostgreSQL, MySQL, and MariaDB."""
        try:
            db_service.create_database(conn, db_name)
            return f"Database '{db_name}' created successfully."
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def create_db_user(username: str, password: str, database: str = "") -> str:
        """Create a new database user and optionally grant all privileges on a specific database.
        Leave database blank to create the user without any grants."""
        try:
            db_service.create_db_user(conn, username, password, database or None)
            msg = f"User '{username}' created."
            if database:
                msg += f" Granted all privileges on '{database}'."
            return msg
        except Exception as e:
            return f"ERROR: {e}"

    return [create_database, create_db_user]
