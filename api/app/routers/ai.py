"""
AI chat router — streams LangGraph agent responses over HTTP SSE and WebSocket.

Chat turns are persisted per-session (see app.services.chat_history_service)
so a session's prior turns are replayed into the agent's context on every
new message, and a lightweight keyword+recency heuristic
(app.services.chat_relevance) surfaces relevant snippets from the user's
OTHER sessions as an extra system message when applicable. db_agent.py stays
stateless/checkpointer-free — all persistence and context assembly happens
here in the router.

Mutating tool calls run in "propose only" mode (see app.agents.db_agent) and
are surfaced to the user as a plan requiring explicit approval — see
pending_plans / commit_plan / reject_plan below.
"""
import asyncio
import uuid
from collections import OrderedDict
from typing import AsyncGenerator, Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.db_agent import create_db_agent
from app.config import settings
from app.database import AsyncSessionLocal, get_session
from app.models.chat_session import ChatSession
from app.routers._common import get_connection_or_404
from app.services import chat_history_service, chat_relevance, papi_service
from app.services.db_service import db_service
from app.websocket.manager import manager

router = APIRouter()

# ── Pending plan store ──────────────────────────────────────────────────────────
# In-memory, per-process — a proposed-but-not-yet-approved set of write steps
# from the agent's last turn, keyed by plan_id. Bounded so a flood of unapproved
# plans can't grow this unboundedly; oldest entries are evicted first.

_MAX_PENDING_PLANS = 500
_pending_plans: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


def _store_plan(conn, steps: list, user_id: str, session_id: str) -> str:
    plan_id = str(uuid.uuid4())
    _pending_plans[plan_id] = {"conn": conn, "steps": steps, "user_id": user_id, "session_id": session_id}
    while len(_pending_plans) > _MAX_PENDING_PLANS:
        _pending_plans.popitem(last=False)
    return plan_id


async def _execute_plan_step(session: AsyncSession, conn, step: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    if step["tool"] == "run_sql_query":
        result = await db_service.run_off_loop(db_service.execute_query, conn, step["sql"], user_id=user_id, source="agent")
        await manager.send(user_id, "agent_query_applied", {
            "connection_id": conn.id, "database": conn.database, "sql": step["sql"], "result": result,
        })
        return result
    if step["tool"] == "create_database":
        await db_service.run_off_loop(db_service.create_database, conn, step["db_name"])
        return {"message": f"Database '{step['db_name']}' created."}
    if step["tool"] == "enable_table_api":
        # Scoped to conn.database, same as every other agent tool (run_sql_query,
        # list_tables, describe_table) — the agent has no notion of "browse a
        # different database on this connection" today, so neither does this.
        table_name = step["table_name"]
        database = conn.database
        status = await papi_service.get_status(session, conn.id, database)
        if not status["enabled"]:
            await papi_service.enable_for_connection(session, conn, database)
        try:
            await papi_service.enable_table(session, conn, database, table_name, user_id)
        except papi_service.PapiError as e:
            return {"error": str(e)}
        return {
            "message": f"API enabled for table '{table_name}'.",
            "endpoint": f"/api/v1/papi/{conn.id}/{database}/{table_name}",
        }
    return {"error": f"Unknown plan step tool: {step['tool']}"}


async def _build_agent_messages(
    session: AsyncSession, *, chat_session: ChatSession, user_id: str, message: str,
) -> list[BaseMessage]:
    """Prior turns of this session, plus (if relevant) a digest of the user's
    other sessions, plus the new message — this is the full input handed to
    the agent's LangGraph state."""
    history_records = await chat_history_service.list_messages(session, session_id=chat_session.id)
    history: list[BaseMessage] = [
        HumanMessage(content=r.content) if r.role == "user" else AIMessage(content=r.content)
        for r in history_records
    ]

    digest = await chat_relevance.build_context_digest(
        session, user_id=user_id, current_session_id=chat_session.id, query_text=message,
    )

    messages: list[BaseMessage] = list(history)
    if digest:
        messages.append(SystemMessage(content=digest))
    messages.append(HumanMessage(content=message))
    return messages


class ChatRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    message: str
    target_connection_id: Optional[str] = None
    session_id: Optional[str] = None
    request_id: Optional[str] = None
    ui_context: Optional[Dict[str, Any]] = None


class PlanActionRequest(BaseModel):
    user_anon_id: str
    plan_id: str


@router.post("/chat")
async def chat(
    body: ChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """Non-streaming chat endpoint — returns the full agent response. Any write
    the agent attempts is only proposed, not executed (see plan_sink)."""
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="AI agent is not configured.")

    conn = await get_connection_or_404(body.connection_id, session)
    target_conn = await get_connection_or_404(body.target_connection_id, session) if body.target_connection_id else None

    chat_session = await chat_history_service.resolve_or_create_session(
        session, session_id=body.session_id, user_id=body.user_anon_id, connection_id=body.connection_id,
    )
    messages = await _build_agent_messages(
        session, chat_session=chat_session, user_id=body.user_anon_id, message=body.message,
    )
    await chat_history_service.persist_user_message(
        session, chat_session=chat_session, user_id=body.user_anon_id, content=body.message,
    )

    plan_sink: list = []
    agent = create_db_agent(
        conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=plan_sink,
        ui_context=body.ui_context,
    )

    state = {
        "messages": messages,
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
        await chat_history_service.persist_assistant_message(session, chat_session=chat_session, content=content)

        response: Dict[str, Any] = {"response": content, "session_id": chat_session.id}
        if plan_sink:
            response["plan_id"] = _store_plan(conn, plan_sink, body.user_anon_id, chat_session.id)
            response["steps"] = plan_sink
        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {e}")


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """SSE streaming chat endpoint — streams tokens as they arrive. Note: plan
    proposals aren't surfaced over SSE today; use /chat or /chat/ws for that.
    Not used by the current frontend (which uses /chat/ws exclusively)."""
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="AI agent is not configured.")

    conn = await get_connection_or_404(body.connection_id, session)
    target_conn = await get_connection_or_404(body.target_connection_id, session) if body.target_connection_id else None

    chat_session = await chat_history_service.resolve_or_create_session(
        session, session_id=body.session_id, user_id=body.user_anon_id, connection_id=body.connection_id,
    )
    messages = await _build_agent_messages(
        session, chat_session=chat_session, user_id=body.user_anon_id, message=body.message,
    )
    await chat_history_service.persist_user_message(
        session, chat_session=chat_session, user_id=body.user_anon_id, content=body.message,
    )

    agent = create_db_agent(
        conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=[],
        ui_context=body.ui_context,
    )

    state = {
        "messages": messages,
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def generate() -> AsyncGenerator[str, None]:
        final_content = ""
        try:
            for chunk in agent.stream(state, stream_mode="values"):
                msgs = chunk.get("messages", [])
                if msgs:
                    last = msgs[-1]
                    content = getattr(last, "content", "")
                    if content:
                        final_content = content
                        yield f"data: {content}\n\n"
            if final_content:
                await chat_history_service.persist_assistant_message(
                    session, chat_session=chat_session, content=final_content,
                )
        except Exception as e:
            yield f"data: [ERROR] {e}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(), media_type="text/event-stream", headers={"X-Session-Id": chat_session.id},
    )


@router.post("/chat/ws")
async def chat_via_ws(
    body: ChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """
    Kick off an async agent run whose tokens are pushed to the user's WebSocket.
    Returns immediately; the outcome arrives via /ws/{user_id} as either
    "agent_done" (pure read/Q&A turn) or "plan_proposed" (the agent wants to
    write something and is waiting for approval — see commit_plan/reject_plan).
    """
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="AI agent is not configured.")

    conn = await get_connection_or_404(body.connection_id, session)
    target_conn = await get_connection_or_404(body.target_connection_id, session) if body.target_connection_id else None

    chat_session = await chat_history_service.resolve_or_create_session(
        session, session_id=body.session_id, user_id=body.user_anon_id, connection_id=body.connection_id,
    )
    messages = await _build_agent_messages(
        session, chat_session=chat_session, user_id=body.user_anon_id, message=body.message,
    )
    await chat_history_service.persist_user_message(
        session, chat_session=chat_session, user_id=body.user_anon_id, content=body.message,
    )

    session_id = chat_session.id
    request_id = body.request_id

    state = {
        "messages": messages,
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def run_agent():
        plan_sink: list = []
        query_ui_sink: list = []
        vector_ui_sink: list = []
        try:
            agent = create_db_agent(
                conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=plan_sink,
                ui_context=body.ui_context, query_ui_sink=query_ui_sink, vector_ui_sink=vector_ui_sink,
            )
            result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
            last_msg = result["messages"][-1]
            content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

            # Mirror any query the agent actually ran (or vector collection it
            # browsed/updated) into the user's Query Editor / Vector Chunks view,
            # same as if they'd done it themselves — before the chat reply arrives,
            # so "done" in chat lines up with the UI already showing it.
            for entry in query_ui_sink:
                await manager.send(body.user_anon_id, "agent_query_applied", {
                    "connection_id": conn.id, "database": conn.database,
                    "sql": entry["sql"], "result": entry["result"],
                })
            for entry in vector_ui_sink:
                await manager.send(body.user_anon_id, "agent_vector_view", {
                    "connection_id": conn.id, "collection": entry["collection"],
                    "database": conn.database, "db_type": conn.db_type,
                })

            # The request-scoped `session` is closed by the time this background
            # task runs — use a fresh one to persist the assistant's reply.
            async with AsyncSessionLocal() as bg_session:
                bg_chat_session = await chat_history_service.get_owned_session_or_404(
                    bg_session, session_id, body.user_anon_id,
                )
                await chat_history_service.persist_assistant_message(
                    bg_session, chat_session=bg_chat_session, content=content,
                )

            if plan_sink:
                plan_id = _store_plan(conn, plan_sink, body.user_anon_id, session_id)
                await manager.send(body.user_anon_id, "plan_proposed", {
                    "plan_id": plan_id, "steps": plan_sink, "summary": content,
                    "session_id": session_id, "request_id": request_id,
                })
            else:
                await manager.send(body.user_anon_id, "agent_done", {
                    "response": content, "session_id": session_id, "request_id": request_id,
                })
        except Exception as e:
            await manager.send(body.user_anon_id, "error", {
                "message": str(e), "session_id": session_id, "request_id": request_id,
            })

    asyncio.create_task(run_agent())
    return {"message": "Agent started. Response will arrive via WebSocket.", "session_id": session_id}


@router.post("/plan/commit")
async def commit_plan(
    body: PlanActionRequest,
    session: AsyncSession = Depends(get_session),
):
    entry = _pending_plans.pop(body.plan_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="Plan not found, already resolved, or expired.")
    if entry["user_id"] != body.user_anon_id:
        raise HTTPException(status_code=403, detail="This plan belongs to a different user.")

    conn = entry["conn"]
    results = []
    for step in entry["steps"]:
        try:
            results.append({"step": step, "result": await _execute_plan_step(session, conn, step, body.user_anon_id)})
        except Exception as e:
            results.append({"step": step, "result": {"error": str(e)}})

    await manager.send(body.user_anon_id, "plan_committed", {
        "plan_id": body.plan_id, "results": results, "session_id": entry.get("session_id"),
    })
    return {"message": "Plan committed.", "results": results}


@router.post("/plan/reject")
async def reject_plan(body: PlanActionRequest):
    entry = _pending_plans.pop(body.plan_id, None)
    if entry and entry["user_id"] == body.user_anon_id:
        await manager.send(body.user_anon_id, "plan_rejected", {
            "plan_id": body.plan_id, "session_id": entry.get("session_id"),
        })
    return {"message": "Plan rejected."}
