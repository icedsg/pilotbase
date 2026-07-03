"""
Records every query/script executed against a target database and pushes it
to connected clients in real time — regardless of whether execution was
triggered by a user action or the AI agent. Deliberately decoupled from
db_service: callers just call record_execution() after running a query,
and it never raises (a history-write failure must not break the query
that's actually being executed).
"""
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import create_engine, desc
from sqlalchemy.orm import sessionmaker

from app.config import settings
from app.models.query_history import QueryHistoryEntry
from app.websocket.manager import manager

log = logging.getLogger("pilotbase.history")

# Separate synchronous engine dedicated to history writes/reads, independent
# of the app's async metadata-DB engine — record_execution() is called from
# both the request event loop and worker threads (LangGraph tool calls), and
# a plain sync session is the simplest thing that's safe in both.
_engine = create_engine(settings.database_url, pool_pre_ping=True, pool_size=5, max_overflow=5)
_Session = sessionmaker(bind=_engine)


def _serialize(entry: QueryHistoryEntry) -> Dict[str, Any]:
    return {
        "id": entry.id,
        "connection_id": entry.connection_id,
        "user_id": entry.user_id,
        "query_text": entry.query_text,
        "source": entry.source,
        "success": entry.success,
        "error": entry.error,
        "row_count": entry.row_count,
        "duration_ms": entry.duration_ms,
        "executed_at": (entry.executed_at or datetime.now(timezone.utc)).isoformat(),
    }


def record_execution(
    *,
    connection_id: str,
    query_text: str,
    duration_ms: float,
    success: bool,
    user_id: Optional[str] = None,
    source: str = "user",
    error: Optional[str] = None,
    row_count: Optional[int] = None,
) -> None:
    try:
        entry = QueryHistoryEntry(
            connection_id=connection_id,
            user_id=user_id,
            query_text=query_text,
            source=source,
            success=success,
            error=error,
            row_count=row_count,
            duration_ms=duration_ms,
        )
        with _Session() as session:
            session.add(entry)
            session.commit()
            session.refresh(entry)
            payload = _serialize(entry)
    except Exception:
        log.exception("Failed to record query history entry")
        return

    manager.broadcast_threadsafe("query_executed", payload)


def list_recent(limit: int = 200) -> List[Dict[str, Any]]:
    with _Session() as session:
        rows = (
            session.query(QueryHistoryEntry)
            .order_by(desc(QueryHistoryEntry.executed_at))
            .limit(limit)
            .all()
        )
        return [_serialize(r) for r in rows]
