"""
Persistence and CRUD for AI chat sessions/messages. All functions take an
injected AsyncSession (the request-scoped one from Depends(get_session), or
a fresh AsyncSessionLocal() for background tasks that outlive the request —
see routers/ai.py's /chat/ws handler).
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.chat_session import ChatMessageRecord, ChatSession

MAX_HISTORY_MESSAGES = 40
TITLE_MAX_LEN = 80


async def get_owned_session_or_404(session: AsyncSession, session_id: str, user_id: str) -> ChatSession:
    result = await session.execute(select(ChatSession).where(ChatSession.id == session_id))
    chat_session = result.scalar_one_or_none()
    if not chat_session or chat_session.is_deleted:
        raise HTTPException(status_code=404, detail="Chat session not found.")
    if chat_session.user_id != user_id:
        raise HTTPException(status_code=403, detail="This chat session belongs to a different user.")
    return chat_session


async def create_session(
    session: AsyncSession, *, user_id: str, connection_id: Optional[str],
) -> ChatSession:
    chat_session = ChatSession(user_id=user_id, connection_id=connection_id)
    session.add(chat_session)
    await session.commit()
    await session.refresh(chat_session)
    return chat_session


async def resolve_or_create_session(
    session: AsyncSession, *, session_id: Optional[str], user_id: str, connection_id: Optional[str],
) -> ChatSession:
    if session_id:
        return await get_owned_session_or_404(session, session_id, user_id)
    return await create_session(session, user_id=user_id, connection_id=connection_id)


async def list_sessions(session: AsyncSession, *, user_id: str, limit: int = 50) -> list[ChatSession]:
    result = await session.execute(
        select(ChatSession)
        .where(ChatSession.user_id == user_id, ChatSession.is_deleted.is_(False))
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
    )
    return list(result.scalars().all())


async def list_messages(
    session: AsyncSession, *, session_id: str, limit: Optional[int] = MAX_HISTORY_MESSAGES,
) -> list[ChatMessageRecord]:
    """Ordered oldest-first. `limit` caps to the most recent N messages (used
    when building agent context); pass None for the full history (used when
    a client reopens a past session)."""
    query = select(ChatMessageRecord).where(ChatMessageRecord.session_id == session_id).order_by(
        ChatMessageRecord.created_at.desc()
    )
    if limit is not None:
        query = query.limit(limit)
    result = await session.execute(query)
    return list(reversed(result.scalars().all()))


async def persist_user_message(
    session: AsyncSession, *, chat_session: ChatSession, user_id: str, content: str,
) -> ChatMessageRecord:
    if chat_session.title is None:
        chat_session.title = content[:TITLE_MAX_LEN]
    chat_session.updated_at = datetime.now(timezone.utc)
    message = ChatMessageRecord(
        session_id=chat_session.id, user_id=user_id, role="user", content=content,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def persist_assistant_message(
    session: AsyncSession, *, chat_session: ChatSession, content: str,
) -> ChatMessageRecord:
    chat_session.updated_at = datetime.now(timezone.utc)
    message = ChatMessageRecord(
        session_id=chat_session.id, user_id=chat_session.user_id, role="assistant", content=content,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)
    return message


async def delete_session(session: AsyncSession, *, session_id: str, user_id: str) -> None:
    chat_session = await get_owned_session_or_404(session, session_id, user_id)
    await session.delete(chat_session)
    await session.commit()


async def list_other_sessions_for_scoring(
    session: AsyncSession, *, user_id: str, exclude_session_id: str, limit: int, messages_per_session: int,
) -> list[tuple[ChatSession, list[ChatMessageRecord]]]:
    """Most-recently-updated other sessions for this user, each with up to
    `messages_per_session` of its most recent messages — used only by the
    keyword+recency relevance heuristic (services/chat_relevance.py)."""
    result = await session.execute(
        select(ChatSession)
        .where(
            ChatSession.user_id == user_id,
            ChatSession.id != exclude_session_id,
            ChatSession.is_deleted.is_(False),
        )
        .order_by(ChatSession.updated_at.desc())
        .limit(limit)
        .options(selectinload(ChatSession.messages))
    )
    candidates = []
    for chat_session in result.scalars().all():
        messages = chat_session.messages[-messages_per_session:]
        if messages:
            candidates.append((chat_session, messages))
    return candidates
