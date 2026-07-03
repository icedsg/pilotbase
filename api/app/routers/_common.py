"""Small helpers shared across routers to avoid repeating the same
connection-lookup boilerplate in every endpoint."""
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connection import DbConnection


async def get_connection_or_404(conn_id: str, session: AsyncSession) -> DbConnection:
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    return conn
