from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.routers._common import get_connection_or_404
from app.services.db_service import db_service
from app.services.export_service import export_service

router = APIRouter()


class ExportSqlRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    database: Optional[str] = None
    tables: List[str]
    create_table: bool = True
    drop_if_exists: bool = False
    include_inserts: bool = False


@router.post("/sql")
async def export_sql(
    body: ExportSqlRequest,
    session: AsyncSession = Depends(get_session),
):
    conn = await get_connection_or_404(body.connection_id, session)
    try:
        sql = await db_service.run_off_loop(
            export_service.generate_sql,
            conn, body.database, body.tables, body.create_table, body.drop_if_exists, body.include_inserts,
        )
        return {"sql": sql}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
