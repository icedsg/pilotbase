from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.connection import DbConnection
from app.services.migration_service import migration_service

router = APIRouter()


class DiffRequest(BaseModel):
    user_anon_id: str
    source_connection_id: str
    target_connection_id: str
    schema: Optional[str] = None


class ScriptRequest(DiffRequest):
    dialect: str = "postgresql"


async def _get_conn(conn_id: str, session: AsyncSession) -> DbConnection:
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail=f"Connection {conn_id} not found.")
    return conn


@router.post("/diff")
async def schema_diff(
    body: DiffRequest,
    session: AsyncSession = Depends(get_session),
):
    source = await _get_conn(body.source_connection_id, session)
    target = await _get_conn(body.target_connection_id, session)
    try:
        diff = migration_service.diff(source, target, body.schema)
        return diff
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/script")
async def migration_script(
    body: ScriptRequest,
    session: AsyncSession = Depends(get_session),
):
    source = await _get_conn(body.source_connection_id, session)
    target = await _get_conn(body.target_connection_id, session)
    try:
        sql = migration_service.generate_migration_sql(source, target, body.schema, body.dialect)
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
