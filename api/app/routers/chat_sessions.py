"""CRUD for AI chat sessions — list past sessions, fetch a session's message
history, and delete a session. Session creation itself is lazy (see
resolve_or_create_session in chat_history_service, used by routers/ai.py's
chat endpoints) — there's no explicit "create" call here since a session is
only worth persisting once it has a first message."""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.services import chat_history_service

router = APIRouter()


def _serialize_session(chat_session) -> dict:
    return {
        "id": chat_session.id,
        "title": chat_session.title,
        "connection_id": chat_session.connection_id,
        "created_at": chat_session.created_at.isoformat(),
        "updated_at": chat_session.updated_at.isoformat(),
    }


def _serialize_message(message) -> dict:
    return {
        "id": message.id,
        "role": message.role,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
    }


@router.get("/")
async def list_sessions(
    user_anon_id: str,
    limit: int = 50,
    session: AsyncSession = Depends(get_session),
):
    sessions = await chat_history_service.list_sessions(session, user_id=user_anon_id, limit=limit)
    return {"sessions": [_serialize_session(s) for s in sessions]}


@router.get("/{session_id}/messages")
async def get_session_messages(
    session_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    chat_session = await chat_history_service.get_owned_session_or_404(session, session_id, user_anon_id)
    messages = await chat_history_service.list_messages(session, session_id=session_id, limit=None)
    return {"session": _serialize_session(chat_session), "messages": [_serialize_message(m) for m in messages]}


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    await chat_history_service.delete_session(session, session_id=session_id, user_id=user_anon_id)
    return {"message": "Chat session deleted."}
