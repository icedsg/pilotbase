"""
AI chat router — streams LangGraph agent responses over HTTP SSE and WebSocket.

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
from langchain_core.messages import HumanMessage
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.db_agent import create_db_agent
from app.config import settings
from app.database import get_session
from app.routers._common import get_connection_or_404
from app.services.db_service import db_service
from app.websocket.manager import manager

router = APIRouter()

# ── Pending plan store ──────────────────────────────────────────────────────────
# In-memory, per-process — a proposed-but-not-yet-approved set of write steps
# from the agent's last turn, keyed by plan_id. Bounded so a flood of unapproved
# plans can't grow this unboundedly; oldest entries are evicted first.

_MAX_PENDING_PLANS = 500
_pending_plans: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


def _store_plan(conn, steps: list, user_id: str) -> str:
    plan_id = str(uuid.uuid4())
    _pending_plans[plan_id] = {"conn": conn, "steps": steps, "user_id": user_id}
    while len(_pending_plans) > _MAX_PENDING_PLANS:
        _pending_plans.popitem(last=False)
    return plan_id


def _execute_plan_step(conn, step: Dict[str, Any], user_id: str) -> Dict[str, Any]:
    if step["tool"] == "run_sql_query":
        return db_service.execute_query(conn, step["sql"], user_id=user_id, source="agent")
    if step["tool"] == "create_database":
        db_service.create_database(conn, step["db_name"])
        return {"message": f"Database '{step['db_name']}' created."}
    return {"error": f"Unknown plan step tool: {step['tool']}"}


class ChatRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    message: str
    target_connection_id: Optional[str] = None


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

    plan_sink: list = []
    agent = create_db_agent(conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=plan_sink)

    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
        last_msg = result["messages"][-1]
        content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
        response: Dict[str, Any] = {"response": content}
        if plan_sink:
            response["plan_id"] = _store_plan(conn, plan_sink, body.user_anon_id)
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
    proposals aren't surfaced over SSE today; use /chat or /chat/ws for that."""
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="AI agent is not configured.")

    conn = await get_connection_or_404(body.connection_id, session)
    target_conn = await get_connection_or_404(body.target_connection_id, session) if body.target_connection_id else None

    agent = create_db_agent(conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=[])

    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def generate() -> AsyncGenerator[str, None]:
        try:
            for chunk in agent.stream(state, stream_mode="values"):
                msgs = chunk.get("messages", [])
                if msgs:
                    last = msgs[-1]
                    content = getattr(last, "content", "")
                    if content:
                        yield f"data: {content}\n\n"
        except Exception as e:
            yield f"data: [ERROR] {e}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")


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

    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def run_agent():
        plan_sink: list = []
        try:
            agent = create_db_agent(
                conn, target_conn, user_id=body.user_anon_id, propose_only=True, plan_sink=plan_sink,
            )
            result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
            last_msg = result["messages"][-1]
            content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)

            if plan_sink:
                plan_id = _store_plan(conn, plan_sink, body.user_anon_id)
                await manager.send(body.user_anon_id, "plan_proposed", {
                    "plan_id": plan_id, "steps": plan_sink, "summary": content,
                })
            else:
                await manager.send(body.user_anon_id, "agent_done", {"response": content})
        except Exception as e:
            await manager.send(body.user_anon_id, "error", {"message": str(e)})

    asyncio.create_task(run_agent())
    return {"message": "Agent started. Response will arrive via WebSocket."}


@router.post("/plan/commit")
async def commit_plan(body: PlanActionRequest):
    entry = _pending_plans.pop(body.plan_id, None)
    if not entry:
        raise HTTPException(status_code=404, detail="Plan not found, already resolved, or expired.")
    if entry["user_id"] != body.user_anon_id:
        raise HTTPException(status_code=403, detail="This plan belongs to a different user.")

    conn = entry["conn"]
    results = []
    for step in entry["steps"]:
        try:
            results.append({"step": step, "result": _execute_plan_step(conn, step, body.user_anon_id)})
        except Exception as e:
            results.append({"step": step, "result": {"error": str(e)}})

    await manager.send(body.user_anon_id, "plan_committed", {"plan_id": body.plan_id, "results": results})
    return {"message": "Plan committed.", "results": results}


@router.post("/plan/reject")
async def reject_plan(body: PlanActionRequest):
    entry = _pending_plans.pop(body.plan_id, None)
    if entry and entry["user_id"] == body.user_anon_id:
        await manager.send(body.user_anon_id, "plan_rejected", {"plan_id": body.plan_id})
    return {"message": "Plan rejected."}
