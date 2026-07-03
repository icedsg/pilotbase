import asyncio
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.permissions import require_admin
from app.config import settings
from app.database import get_session
from app.routers._common import get_connection_or_404
from app.services.backup_service import BackupUnsupportedError, backup_service

router = APIRouter()


class BackupRequest(BaseModel):
    user_anon_id: str
    connection_id: str
    database: Optional[str] = None


def _safe_backup_path(filename: str) -> str:
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename.")
    return os.path.join(settings.backups_dir, filename)


@router.post("/run")
async def run_backup(
    body: BackupRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    conn = await get_connection_or_404(body.connection_id, session)

    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, backup_service.run_backup, conn, body.database)
        return {"message": "Backup completed.", "file": result["filename"], **result}
    except BackupUnsupportedError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backup failed: {e}")


@router.get("/list")
async def list_backups(
    user_anon_id: str,
    connection_name: str = "",
    session: AsyncSession = Depends(get_session),
):
    await require_admin(user_anon_id, session)
    return {"backups": backup_service.list_backups(connection_name or None)}


@router.get("/download/{filename}")
async def download_backup(
    filename: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(user_anon_id, session)
    path = _safe_backup_path(filename)
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="Backup file not found.")
    return FileResponse(path, filename=filename, media_type="application/octet-stream")
