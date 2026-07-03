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
from app.agents.tools.migration_tools import make_migration_tools
from app.agents.tools.query_tools import make_query_tools
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

WORKFLOW — inspect first, then propose: use the read-only tools (list_tables, describe_table,
list_databases, schema diff) freely to understand the database. Any write (INSERT, UPDATE,
CREATE, ALTER, create_database) you request is NOT executed immediately — it is queued as a
proposed plan step and shown to the user, who must explicitly approve it before anything is
actually run. Tell the user what you're about to propose and why before calling a write tool.

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
):
    """
    Build and compile a LangGraph ReAct agent for the given DbConnection.
    Returns a CompiledGraph that can be invoked with AgentState.
    """
    tools = (
        make_query_tools(conn, user_id, propose_only, plan_sink)
        + make_admin_tools(conn, propose_only, plan_sink)
        + make_vector_tools(conn, user_id)
        + make_backup_tools(conn)
        + make_migration_tools(conn, target_conn)
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
