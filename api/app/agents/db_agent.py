"""
LangGraph-based database AI agent.

Graph:  agent ←→ tools (ReAct loop)

The agent is re-created per chat session so it carries connection context.
For production use with many concurrent sessions, consider checkpointer-based persistence.

Plan/approve/commit: rather than a LangGraph checkpointer + interrupt() (which
would need a persistent thread_id threaded through the WS layer — a large
change for a per-request agent with no persistence today), mutating tools are
run in "propose only" mode: they append their intended action to plan_sink
instead of executing, and the router (routers/ai.py) surfaces plan_sink to the
user for an explicit approve/reject before anything actually runs.
"""
from typing import Annotated, Optional

from langchain_openai import ChatOpenAI
from langchain_core.messages import BaseMessage, SystemMessage
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing_extensions import TypedDict

from app.agents.tools.admin_tools import make_admin_tools
from app.agents.tools.backup_tools import make_backup_tools
from app.agents.tools.docs_tools import make_docs_tools
from app.agents.tools.migration_tools import make_migration_tools
from app.agents.tools.papi_tools import make_papi_tools
from app.agents.tools.query_tools import make_query_tools
from app.agents.tools.ui_context_tools import make_ui_context_tools
from app.agents.tools.vector_tools import make_vector_tools
from app.config import settings


class AgentState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
    connection_id: str
    user_id: str


SYSTEM_PROMPT = """You are Pilotbase AI — a helpful, expert database assistant.
You have access to tools that let you:
- Query the connected database (SELECT, INSERT, UPDATE, CREATE, ALTER)
- List databases, tables, views, and vector collections
- Describe table schemas
- Browse and update vector collection chunks
- Create databases (PostgreSQL, MySQL, MariaDB, SQL Server, CockroachDB, Snowflake)
- Trigger and list backups
- Compare schemas and generate migration scripts
- Expose a table as a public REST CRUD API (enable_table_api)
- See what the user currently has open elsewhere in the UI (get_ui_state)
- Search Pilotbase's own documentation (list_docs, read_doc)

WORKFLOW — inspect first, then propose: use the read-only tools (list_tables, describe_table,
list_databases, schema diff) freely to understand the database. Any write (INSERT, UPDATE,
CREATE, ALTER, create_database, enable_table_api) you request is NOT executed immediately — it
is queued as a proposed plan step and shown to the user, who must explicitly approve it before
anything is actually run. Tell the user what you're about to propose and why before calling a
write tool.

For "how do I configure/set up X" or usage questions, check list_docs/read_doc before answering
from general knowledge — Pilotbase's own docs may have a specific, correct answer. If the user
refers to "this query", "what I'm looking at", or similar without repeating it, call
get_ui_state to see the SQL editor / active database / other panels they currently have open.

MongoDB, Qdrant, and other non-SQL connections take a JSON query envelope, not SQL or mongo-shell/JS
syntax — run_sql_query's own description spells out the exact JSON shape for the connected database;
follow it literally rather than writing e.g. `db.collection.aggregate(...)`.

When the user asks you to change/fix/write a query and run it, just call run_sql_query with the
new query — you do not need to ask them to paste it into the editor or run it themselves. Every
query you execute (and every vector collection you browse or update a chunk in) is automatically
mirrored into the matching UI panel (Query Editor + results grid, or Vector Chunks view) as if the
user had done it, so once the tool call succeeds you can just confirm briefly (e.g. "Done — updated
the query and ran it, N rows returned") instead of repeating the full result back in chat.

IMPORTANT — the following are permanently unavailable to you, not just gated behind approval:
  DROP TABLE, DROP VIEW, DROP DATABASE, DELETE, TRUNCATE, creating/altering database users or
  permissions (GRANT/REVOKE/CREATE USER/ALTER USER), and deleting vector chunks.
If the user asks you to perform any of these, politely explain that these operations
are secured to the UI for safety, and direct them to use the relevant UI action instead.

Format query results clearly. For large result sets, summarise instead of printing every row.
"""


def create_db_agent(
    conn,
    target_conn=None,
    user_id: Optional[str] = None,
    propose_only: bool = False,
    plan_sink: Optional[list] = None,
    ui_context: Optional[dict] = None,
    query_ui_sink: Optional[list] = None,
    vector_ui_sink: Optional[list] = None,
):
    """
    Build and compile a LangGraph ReAct agent for the given DbConnection.
    Returns a CompiledGraph that can be invoked with AgentState.

    query_ui_sink / vector_ui_sink, when given, are filled in as the agent
    actually runs queries or browses/updates vector chunks, so the caller
    (routers/ai.py) can mirror those actions into the user's Query Editor /
    Vector Chunks view over the websocket — see make_query_tools/make_vector_tools.
    """
    tools = (
        make_query_tools(conn, user_id, propose_only, plan_sink, query_ui_sink)
        + make_admin_tools(conn, propose_only, plan_sink)
        + make_vector_tools(conn, user_id, vector_ui_sink)
        + make_backup_tools(conn)
        + make_migration_tools(conn, target_conn)
        + make_papi_tools(conn, propose_only, plan_sink)
        + make_ui_context_tools(ui_context)
        + make_docs_tools()
    )

    llm = ChatOpenAI(
        model=settings.ollama_model,
        base_url=settings.ollama_base_url,
        api_key=settings.ollama_api_key,
    ).bind_tools(tools)

    def should_continue(state: AgentState) -> str:
        last = state["messages"][-1]
        if getattr(last, "tool_calls", None):
            return "tools"
        return END

    def call_model(state: AgentState) -> dict:
        messages = [SystemMessage(content=SYSTEM_PROMPT)] + state["messages"]
        response = llm.invoke(messages)
        return {"messages": [response]}

    tool_node = ToolNode(tools)

    builder = StateGraph(AgentState)
    builder.add_node("agent", call_model)
    builder.add_node("tools", tool_node)
    builder.set_entry_point("agent")
    builder.add_conditional_edges("agent", should_continue)
    builder.add_edge("tools", "agent")

    return builder.compile()
