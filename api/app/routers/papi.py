"""
Generated CRUD API — the externally-facing surface a developer's own app talks
to directly (mobile app, external service, ...). Separate auth model from the
rest of Pilotbase: no Pilotbase session/user_anon_id here, just a self-service
JWT session minted via POST .../apitokens and passed as `Authorization: Bearer`
on every other call.
"""
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.connection import DbConnection
from app.papi_ratelimit import rate_limit_create_token, rate_limit_validate
from app.routers._common import get_connection_or_404
from app.services import papi_service

router = APIRouter()


async def _require_enabled(conn_id: str, session: AsyncSession) -> tuple[DbConnection, str]:
    conn = await get_connection_or_404(conn_id, session)
    secret = await papi_service.get_secret(session, conn_id)
    if not secret:
        raise HTTPException(status_code=403, detail="Generated API is not enabled for this connection.")
    return conn, secret


async def _authed_connection(
    conn_id: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
) -> DbConnection:
    conn, secret = await _require_enabled(conn_id, session)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1]
    if not papi_service.validate_token(conn, secret, token):
        raise HTTPException(status_code=401, detail="Invalid, expired, or revoked token.")
    return conn


@router.post("/{conn_id}/apitokens", dependencies=[Depends(rate_limit_create_token)])
async def create_token(
    conn_id: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    conn, secret = await _require_enabled(conn_id, session)
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    token = papi_service.create_token(conn, secret, ip, user_agent)
    return {"token": token}


@router.get("/{conn_id}/apitokens/validate", dependencies=[Depends(rate_limit_validate)])
async def validate_token_endpoint(
    conn_id: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
):
    conn, secret = await _require_enabled(conn_id, session)
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"valid": False}
    token = authorization.split(" ", 1)[1]
    return {"valid": papi_service.validate_token(conn, secret, token)}


async def _require_table_enabled(session: AsyncSession, conn: DbConnection, table: str) -> None:
    if not await papi_service.is_table_enabled(session, conn.id, table):
        raise HTTPException(status_code=404, detail=f"Generated API is not enabled for table '{table}'.")


@router.get("/{conn_id}/{table}")
async def list_rows(
    table: str,
    limit: int = 100,
    offset: int = 0,
    conn: DbConnection = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    await _require_table_enabled(session, conn, table)
    try:
        return {"rows": papi_service.list_rows(conn, table, min(limit, 1000), max(offset, 0))}
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{conn_id}/{table}/{guid}")
async def get_row(
    table: str,
    guid: str,
    conn: DbConnection = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    await _require_table_enabled(session, conn, table)
    try:
        row = papi_service.get_row(conn, table, guid)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if row is None:
        raise HTTPException(status_code=404, detail="Row not found.")
    return row


@router.post("/{conn_id}/{table}")
async def create_row(
    table: str,
    body: Dict[str, Any],
    conn: DbConnection = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    await _require_table_enabled(session, conn, table)
    try:
        return papi_service.create_row(conn, table, body)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{conn_id}/{table}/{guid}")
async def update_row(
    table: str,
    guid: str,
    body: Dict[str, Any],
    conn: DbConnection = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    await _require_table_enabled(session, conn, table)
    try:
        matched = papi_service.update_row(conn, table, guid, body)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not matched:
        raise HTTPException(status_code=404, detail="Row not found.")
    return {"message": "Updated."}


@router.delete("/{conn_id}/{table}/{guid}")
async def delete_row(
    table: str,
    guid: str,
    conn: DbConnection = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    await _require_table_enabled(session, conn, table)
    try:
        matched = papi_service.soft_delete_row(conn, table, guid)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not matched:
        raise HTTPException(status_code=404, detail="Row not found.")
    return {"message": "Deleted (soft)."}
