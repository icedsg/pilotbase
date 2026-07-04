import re
from typing import Optional

from langchain_core.tools import tool
from app.services.db_service import check_agent_forbidden, db_service

_READ_ONLY_RE = re.compile(r"^\s*(SELECT|WITH|SHOW|EXPLAIN|DESCRIBE|DESC)\b", re.IGNORECASE)


def _is_read_only(query: str) -> bool:
    import sqlparse
    statements = [s.strip() for s in sqlparse.split(query) if s.strip()] or [query]
    return all(_READ_ONLY_RE.match(s) for s in statements)


def make_query_tools(
    conn,
    user_id: Optional[str] = None,
    propose_only: bool = False,
    plan_sink: Optional[list] = None,
    ui_sink: Optional[list] = None,
):
    """Return query tools bound to a specific DbConnection instance.

    Destructive/permission-changing statements (DROP, DELETE, TRUNCATE, GRANT,
    REVOKE, CREATE|ALTER|DROP USER|ROLE, ...) are enforced centrally in
    db_service.execute_query for source="agent" — not re-implemented here, so
    the guard can't be bypassed by adding new tools. They're also rejected
    right here at proposal time so they never even make it into a plan a user
    could approve.

    When propose_only is set, mutating statements (anything that isn't plainly
    read-only) are appended to plan_sink instead of executed, and a "PLANNED"
    placeholder is returned to the LLM so the ReAct loop can keep narrating.
    Read-only statements always execute immediately so the agent can inspect
    state before proposing a plan.

    ui_sink, when given, collects one entry per query actually executed here
    (query, result) so the caller (routers/ai.py) can push it to the user's
    Query Editor over the websocket — mirroring what happens when the user
    types the query themselves and hits Run. Statements that only get
    PLANNED are not pushed; that happens later, when the plan is committed."""

    @tool
    def run_sql_query(query: str) -> str:
        """Execute a SQL query on the connected database and return results as a formatted string.
        Use for SELECT, INSERT, UPDATE, CREATE, and ALTER statements. Always LIMIT large result sets.
        DROP, DELETE, TRUNCATE, and permission changes (GRANT/REVOKE/CREATE|ALTER USER) are not
        permitted — direct the user to the UI for those. The query and its result are mirrored into
        the user's Query Editor / results grid automatically — no need to ask them to run it themselves."""
        def _format_one(result: dict) -> str:
            if result.get("error"):
                return f"ERROR: {result['error']}"
            if result["columns"]:
                header = " | ".join(result["columns"])
                sep = "-" * len(header)
                rows_str = "\n".join(
                    " | ".join(str(v) for v in row.values()) for row in result["rows"][:50]
                )
                truncated = "\n(truncated to 50 rows)" if result.get("truncated") else ""
                return f"{header}\n{sep}\n{rows_str}{truncated}"
            return f"Query executed. Rows affected: {result.get('affected', 0)}"

        blocked = check_agent_forbidden(query)
        if blocked:
            return f"BLOCKED: {blocked} is not permitted through the AI agent. Use the Pilotbase UI for this."

        if propose_only and not _is_read_only(query):
            if plan_sink is not None:
                plan_sink.append({"tool": "run_sql_query", "sql": query})
            return f"PLANNED (awaiting user approval, not yet executed): {query}"

        try:
            result = db_service.execute_query(conn, query, user_id=user_id, source="agent")
            if ui_sink is not None:
                pushed = result["results"][-1] if result.get("multi") else result
                ui_sink.append({"sql": query, "result": pushed})
            if result.get("multi"):
                return "\n\n".join(
                    f"-- Statement {i + 1} --\n{_format_one(r)}" for i, r in enumerate(result["results"])
                )
            return _format_one(result)
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
