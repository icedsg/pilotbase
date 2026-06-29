"""
LangGraph-based database AI agent.

Graph:  agent ←→ tools (ReAct loop)

The agent is re-created per chat session so it carries connection context.
For production use with many concurrent sessions, consider checkpointer-based persistence.
"""
from typing import Annotated

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
- Create databases and users (PostgreSQL, MySQL, MariaDB)
- Trigger and list backups
- Compare schemas and generate migration scripts

IMPORTANT — the following operations are intentionally locked to the Pilotbase UI and are NOT available to you:
  DROP TABLE, DROP VIEW, DROP DATABASE, DELETE, TRUNCATE, and deleting vector chunks.
If the user asks you to perform any of these, politely explain that these destructive operations
are secured to the UI for safety, and direct them to use the relevant UI action instead.

Format query results clearly. For large result sets, summarise instead of printing every row.
"""


def create_db_agent(conn, target_conn=None):
    """
    Build and compile a LangGraph ReAct agent for the given DbConnection.
    Returns a CompiledGraph that can be invoked with AgentState.
    """
    tools = (
        make_query_tools(conn)
        + make_admin_tools(conn)
        + make_vector_tools(conn)
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
