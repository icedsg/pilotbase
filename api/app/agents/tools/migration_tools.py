from langchain_core.tools import tool
from app.services.migration_service import migration_service


def make_migration_tools(source_conn, target_conn=None):
    """Return migration/diff tools. target_conn may be the same db for intra-schema diffs."""

    @tool
    def show_schema_diff(target_connection_name: str = "") -> str:
        """
        Compare the schema of the current connection against another connection.
        Returns a summary of added tables, dropped tables, and column changes.
        Provide target_connection_name if not already configured.
        """
        if target_conn is None:
            return "No target connection configured. Provide a second connection via the migration API."
        try:
            diff = migration_service.diff(source_conn, target_conn)
            lines = []
            if diff["added_tables"]:
                lines.append(f"Tables to add: {', '.join(diff['added_tables'])}")
            if diff["dropped_tables"]:
                lines.append(f"Tables to drop (WARNING): {', '.join(diff['dropped_tables'])}")
            for table, changes in diff["column_changes"].items():
                if changes["added"]:
                    lines.append(f"{table}: add columns {changes['added']}")
                if changes["dropped"]:
                    lines.append(f"{table}: drop columns (WARNING) {changes['dropped']}")
                if changes["modified"]:
                    lines.append(f"{table}: modify columns {changes['modified']}")
            return "\n".join(lines) if lines else "Schemas are identical."
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def generate_migration_script() -> str:
        """Generate a SQL migration script to bring the target database in line with the source."""
        if target_conn is None:
            return "No target connection configured."
        try:
            sql = migration_service.generate_migration_sql(source_conn, target_conn)
            return sql
        except Exception as e:
            return f"ERROR: {e}"

    return [show_schema_diff, generate_migration_script]
