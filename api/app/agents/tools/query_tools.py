import re

from langchain_core.tools import tool
from app.services.db_service import db_service

_DESTRUCTIVE = re.compile(r'^\s*(DROP|DELETE|TRUNCATE)\b', re.IGNORECASE | re.MULTILINE)


def make_query_tools(conn):
    """Return query tools bound to a specific DbConnection instance."""

    @tool
    def run_sql_query(query: str) -> str:
        """Execute a SQL query on the connected database and return results as a formatted string.
        Use for SELECT, INSERT, UPDATE, CREATE, and ALTER statements. Always LIMIT large result sets.
        DROP, DELETE, and TRUNCATE are not permitted — direct the user to the UI for those."""
        if _DESTRUCTIVE.search(query):
            return "BLOCKED: DROP, DELETE, and TRUNCATE operations are secured to the UI. Please use the Pilotbase interface to perform this action."
        try:
            result = db_service.execute_query(conn, query)
            if result["columns"]:
                header = " | ".join(result["columns"])
                sep = "-" * len(header)
                rows_str = "\n".join(
                    " | ".join(str(v) for v in row.values()) for row in result["rows"][:50]
                )
                truncated = "\n(truncated to 50 rows)" if result.get("truncated") else ""
                return f"{header}\n{sep}\n{rows_str}{truncated}"
            return f"Query executed. Rows affected: {result.get('affected', 0)}"
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def list_tables(schema: str = "") -> str:
        """List all tables and views in the database (optionally filtered by schema)."""
        try:
            objects = db_service.list_objects(conn, schema or None)
            if not objects:
                return "No tables or views found."
            return "\n".join(f"[{o['type']}] {o['name']}" for o in objects)
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def describe_table(table_name: str) -> str:
        """Return the schema of a table: columns, types, nullability, primary keys, foreign keys."""
        try:
            info = db_service.describe_table(conn, table_name)
            lines = [f"Table: {table_name}", "Columns:"]
            for c in info["columns"]:
                pk = " (PK)" if c["name"] in info["primary_keys"] else ""
                null = " NULL" if c["nullable"] else " NOT NULL"
                lines.append(f"  {c['name']} {c['type']}{null}{pk}")
            if info["foreign_keys"]:
                lines.append("Foreign keys:")
                for fk in info["foreign_keys"]:
                    lines.append(f"  {fk['constrained_columns']} → {fk['referred_table']}.{fk['referred_columns']}")
            return "\n".join(lines)
        except Exception as e:
            return f"ERROR: {e}"

    @tool
    def list_databases() -> str:
        """List all databases available on this connection."""
        try:
            dbs = db_service.list_databases(conn)
            return "\n".join(dbs) if dbs else "No databases found."
        except Exception as e:
            return f"ERROR: {e}"

    return [run_sql_query, list_tables, describe_table, list_databases]
