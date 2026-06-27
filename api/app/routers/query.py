from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.connection import DbConnection
from app.services.db_service import db_service

router = APIRouter()


class QueryRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    query: str
    params: Optional[dict] = None
    limit: int = 1000
    database: Optional[str] = None


@router.post("/execute")
async def execute_query(
    body: QueryRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(
        select(DbConnection).where(DbConnection.id == body.connection_id, DbConnection.is_active == True)  # noqa: E712
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")

    try:
        data = db_service.execute_query(conn, body.query, body.params, body.limit, body.database)
        return data
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class DDLRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    action: str          # truncate | drop_table | drop_database | create_database
    object_name: str
    object_type: str     # table | database


@router.post("/ddl")
async def run_ddl(
    body: DDLRequest,
    session: AsyncSession = Depends(get_session),
):
    """Execute destructive DDL (TRUNCATE / DROP). Requires confirmation from the client."""
    result = await session.execute(
        select(DbConnection).where(DbConnection.id == body.connection_id)
    )
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")

    action_map = {
        ("truncate", "table"):           f'TRUNCATE TABLE "{body.object_name}"',
        ("drop_table", "table"):         f'DROP TABLE IF EXISTS "{body.object_name}"',
        ("drop_view", "view"):           f'DROP VIEW IF EXISTS "{body.object_name}"',
        ("drop_database", "database"):   f'DROP DATABASE IF EXISTS "{body.object_name}"',
        ("create_database", "database"): f'CREATE DATABASE "{body.object_name}"',
    }

    sql = action_map.get((body.action, body.object_type))
    if not sql:
        raise HTTPException(status_code=400, detail="Unsupported DDL action.")

    try:
        db_service.execute_query(conn, sql)
        return {"message": f"{body.action} on {body.object_name} executed successfully."}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
