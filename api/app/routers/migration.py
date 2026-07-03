from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.database import get_session
from app.routers._common import get_connection_or_404
from app.services.migration_service import migration_service

router = APIRouter()


class DiffRequest(BaseModel):
    user_anon_id: str
    source_connection_id: str
    target_connection_id: str
    schema: Optional[str] = None


class ScriptRequest(DiffRequest):
    dialect: str = "postgresql"


@router.post("/diff")
async def schema_diff(
    body: DiffRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        return migration_service.diff(source, target, body.schema)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/script")
async def migration_script(
    body: ScriptRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    source = await get_connection_or_404(body.source_connection_id, session)
    target = await get_connection_or_404(body.target_connection_id, session)
    try:
        sql = migration_service.generate_migration_sql(source, target, body.schema, body.dialect)
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
