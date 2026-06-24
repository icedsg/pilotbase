from langchain_core.tools import tool
from app.services.backup_service import backup_service


def make_backup_tools(conn):
    """Return backup tools bound to a specific DbConnection instance."""

    @tool
    def run_backup() -> str:
        """Trigger a backup of the connected database. Returns the backup file path."""
        try:
            path = backup_service.run_backup(conn)
            return f"Backup completed: {path}"
        except Exception as e:
            return f"ERROR: Backup failed — {e}"

    @tool
    def list_backups() -> str:
        """List all available backups for this connection."""
        try:
            backups = backup_service.list_backups(conn.name)
            if not backups:
                return "No backups found."
            lines = [f"{b['filename']} ({b['size_bytes'] // 1024} KB, {b['created_at']})" for b in backups]
            return "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    return [run_backup, list_backups]
