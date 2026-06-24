"""
AI chat router — streams LangGraph agent responses over HTTP SSE and WebSocket.
"""
import asyncio
from typing import AsyncGenerator, Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.db_agent import create_db_agent
from app.config import settings
from app.database import get_session
from app.models.connection import DbConnection
from app.websocket.manager import manager

router = APIRouter()


class ChatRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    message: str
    target_connection_id: Optional[str] = None


async def _get_conn(conn_id: str, session: AsyncSession) -> DbConnection:
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found.")
    return conn


@router.post("/chat")
async def chat(
    body: ChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """Non-streaming chat endpoint — returns the full agent response."""
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="OLLAMA_API_KEY not configured.")

    conn = await _get_conn(body.connection_id, session)
    target_conn = await _get_conn(body.target_connection_id, session) if body.target_connection_id else None

    agent = create_db_agent(conn, target_conn)

    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    try:
        result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
        last_msg = result["messages"][-1]
        return {"response": last_msg.content if hasattr(last_msg, "content") else str(last_msg)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Agent error: {e}")


@router.post("/chat/stream")
async def chat_stream(
    body: ChatRequest,
    session: AsyncSession = Depends(get_session),
):
    """SSE streaming chat endpoint — streams tokens as they arrive."""
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="OLLAMA_API_KEY not configured.")

    conn = await _get_conn(body.connection_id, session)
    target_conn = await _get_conn(body.target_connection_id, session) if body.target_connection_id else None

    agent = create_db_agent(conn, target_conn)

    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def generate() -> AsyncGenerator[str, None]:
        loop = asyncio.get_event_loop()
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
    Returns immediately; tokens arrive via /ws/{user_id}.
    """
    if not settings.ollama_api_key:
        raise HTTPException(status_code=503, detail="OLLAMA_API_KEY not configured.")

    conn = await _get_conn(body.connection_id, session)
    target_conn = await _get_conn(body.target_connection_id, session) if body.target_connection_id else None

    agent = create_db_agent(conn, target_conn)
    state = {
        "messages": [HumanMessage(content=body.message)],
        "connection_id": body.connection_id,
        "user_id": body.user_anon_id,
    }

    async def run_agent():
        try:
            result = await asyncio.get_event_loop().run_in_executor(None, lambda: agent.invoke(state))
            last_msg = result["messages"][-1]
            content = last_msg.content if hasattr(last_msg, "content") else str(last_msg)
            await manager.send(body.user_anon_id, "agent_done", {"response": content})
        except Exception as e:
            await manager.send(body.user_anon_id, "error", {"message": str(e)})

    asyncio.create_task(run_agent())
    return {"message": "Agent started. Response will arrive via WebSocket."}
