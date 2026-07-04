from typing import Optional

from langchain_core.tools import tool


def make_papi_tools(conn, propose_only: bool = False, plan_sink: Optional[list] = None):
    """Return the generated-API tool bound to a specific DbConnection.

    Enabling a table's public REST API always goes through the propose/approve
    flow (like create_database in admin_tools.py) — there's no immediate-execution
    branch here because actually registering the table requires an AsyncSession,
    which tools don't have access to; every current call site in routers/ai.py
    passes propose_only=True anyway. Approval executes app.services.papi_service
    .enable_table via ai.py's commit_plan/_execute_plan_step."""

    @tool
    def enable_table_api(table_name: str) -> str:
        """Expose a table as a public REST CRUD API (GET/POST/PUT/DELETE), secured
        by a self-service JWT bearer token. Requires explicit user approval, like
        other write actions, before it takes effect."""
        if plan_sink is not None:
            plan_sink.append({"tool": "enable_table_api", "table_name": table_name})
        return f"PLANNED (awaiting user approval, not yet executed): expose '{table_name}' via the generated API."

    return [enable_table_api]
