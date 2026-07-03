from fastapi import APIRouter, Query

from app.services import history_service

router = APIRouter()


@router.get("")
async def get_query_history(limit: int = Query(default=200, le=1000)):
    return {"entries": history_service.list_recent(limit)}
