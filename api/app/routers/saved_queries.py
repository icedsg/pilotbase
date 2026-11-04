from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.anon_auth import get_auth_backend
from app.database import get_session
from app.models.connection import DbConnection
from app.models.saved_query import SavedQuery

router = APIRouter()


class SavedQueryBody(BaseModel):
    user_anon_id: str
    connection_id: str
    name: str = Field(min_length=1, max_length=120)
    query_text: str = Field(min_length=1)


def _serialize(item: SavedQuery) -> dict:
    return {
        "id": item.id,
        "connection_id": item.connection_id,
        "name": item.name,
        "query_text": item.query_text,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


async def _user_id(session: AsyncSession, anon_id: str) -> str:
    user = await get_auth_backend().get_or_create_user(session, anon_id)
    return user.id


@router.get("")
async def list_saved_queries(
    user_anon_id: str,
    connection_id: str,
    session: AsyncSession = Depends(get_session),
):
    user_id = await _user_id(session, user_anon_id)
    connection = await session.get(DbConnection, connection_id)
    if not connection or not connection.is_active:
        raise HTTPException(status_code=404, detail="Connection not found.")
    result = await session.execute(
        select(SavedQuery)
        .where(SavedQuery.user_id == user_id, SavedQuery.connection_id == connection_id)
        .order_by(SavedQuery.updated_at.desc(), SavedQuery.name)
    )
    return {"queries": [_serialize(item) for item in result.scalars()]}


@router.post("")
async def create_saved_query(body: SavedQueryBody, session: AsyncSession = Depends(get_session)):
    user_id = await _user_id(session, body.user_anon_id)
    connection = await session.get(DbConnection, body.connection_id)
    if not connection or not connection.is_active:
        raise HTTPException(status_code=404, detail="Connection not found.")
    item = SavedQuery(
        user_id=user_id,
        connection_id=body.connection_id,
        name=body.name.strip(),
        query_text=body.query_text,
    )
    if not item.name:
        raise HTTPException(status_code=422, detail="Name is required.")
    session.add(item)
    await session.commit()
    await session.refresh(item)
    return _serialize(item)


@router.delete("/{query_id}")
async def delete_saved_query(
    query_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    user_id = await _user_id(session, user_anon_id)
    result = await session.execute(
        select(SavedQuery).where(SavedQuery.id == query_id, SavedQuery.user_id == user_id)
    )
    item = result.scalar_one_or_none()
    if not item:
        raise HTTPException(status_code=404, detail="Saved query not found.")
    await session.delete(item)
    await session.commit()
    return {"message": "Saved query deleted."}
