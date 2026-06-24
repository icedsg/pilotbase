from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.connection import DbConnection
from app.services.backup_service import backup_service

router = APIRouter()


class BackupRequest(BaseModel):
    user_anon_id: str
    connection_id: str


@router.post("/run")
async def run_backup(
    body: BackupRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == body.connection_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")

    try:
        path = backup_service.run_backup(conn)
        return {"message": "Backup completed.", "file": path}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")


@router.get("/list")
async def list_backups(user_anon_id: str, connection_name: str = ""):
    return {"backups": backup_service.list_backups(connection_name or None)}


@router.get("/download/{filename}")
async def download_backup(filename: str, user_anon_id: str):
    import os
    from app.config import settings

    path = os.path.join(settings.backups_dir, filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup file not found.")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
