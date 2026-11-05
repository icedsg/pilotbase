"""The Health view, the first screen after connecting to PostgreSQL, MySQL or MariaDB."""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.anon_auth import get_auth_backend
from app.database import get_session
from app.models.connection import DbConnection
from app.models.health_check import HealthMigrationCheck
from app.services import health_service
from app.services.db_service import db_service

router = APIRouter()


class SnapshotBody(BaseModel):
    user_anon_id: str
    connection_id: str
    database: Optional[str] = None


class MigrationCheckBody(BaseModel):
    user_anon_id: str
    connection_id: str
    sql_text: str = Field(min_length=1, max_length=2_000_000)


async def _active_connection(session: AsyncSession, connection_id: str) -> DbConnection:
    conn = await session.get(DbConnection, connection_id)
    if not conn or not conn.is_active:
        raise HTTPException(status_code=404, detail="Connection not found.")
    return conn


def _read(conn: DbConnection, database: Optional[str]):
    return health_service.snapshot(db_service.get_adapter(conn), conn.db_type, database)


@router.post("/snapshot")
async def snapshot(body: SnapshotBody, session: AsyncSession = Depends(get_session)):
    conn = await _active_connection(session, body.connection_id)
    if conn.db_type not in health_service.HEALTH_DB_TYPES:
        raise HTTPException(status_code=400, detail=f"Health isn't available for {conn.db_type}.")
    try:
        return await db_service.run_off_loop(_read, conn, body.database or conn.database)
    except Exception as e:
        raise HTTPException(status_code=400, detail=health_service.first_line(e))


def _serialize(item: Optional[HealthMigrationCheck]) -> Optional[dict]:
    if not item:
        return None
    return {"sql_text": item.sql_text, "checked_at": item.checked_at.isoformat()}


async def _find(session: AsyncSession, user_id: str, connection_id: str) -> Optional[HealthMigrationCheck]:
    result = await session.execute(
        select(HealthMigrationCheck).where(
            HealthMigrationCheck.user_id == user_id, HealthMigrationCheck.connection_id == connection_id,
        )
    )
    return result.scalar_one_or_none()


@router.get("/last-migration")
async def last_migration(user_anon_id: str, connection_id: str, session: AsyncSession = Depends(get_session)):
    await _active_connection(session, connection_id)
    user = await get_auth_backend().get_or_create_user(session, user_anon_id)
    return {"check": _serialize(await _find(session, user.id, connection_id))}


@router.put("/last-migration")
async def save_last_migration(body: MigrationCheckBody, session: AsyncSession = Depends(get_session)):
    await _active_connection(session, body.connection_id)
    user = await get_auth_backend().get_or_create_user(session, body.user_anon_id)
    item = await _find(session, user.id, body.connection_id)
    now = datetime.now(timezone.utc)
    if item:
        item.sql_text, item.checked_at = body.sql_text, now
    else:
        item = HealthMigrationCheck(
            user_id=user.id, connection_id=body.connection_id, sql_text=body.sql_text, checked_at=now,
        )
        session.add(item)
    await session.commit()
    return {"check": _serialize(item)}
