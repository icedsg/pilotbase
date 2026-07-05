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


async def _require_enabled(conn_id: str, database: str, session: AsyncSession) -> tuple[DbConnection, str]:
    conn = await get_connection_or_404(conn_id, session)
    secret = await papi_service.get_secret(session, conn_id, database)
    if not secret:
        raise HTTPException(status_code=403, detail="Generated API is not enabled for this database.")
    return conn, secret


async def _authed_connection(
    conn_id: str,
    database: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
) -> tuple[DbConnection, str]:
    conn, secret = await _require_enabled(conn_id, database, session)
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer token.")
    token = authorization.split(" ", 1)[1]
    if not papi_service.validate_token(conn, database, secret, token):
        raise HTTPException(status_code=401, detail="Invalid, expired, or revoked token.")
    return conn, database


@router.post("/{conn_id}/{database}/apitokens", dependencies=[Depends(rate_limit_create_token)])
async def create_token(
    conn_id: str,
    database: str,
    request: Request,
    session: AsyncSession = Depends(get_session),
):
    conn, secret = await _require_enabled(conn_id, database, session)
    ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    token = papi_service.create_token(conn, database, secret, ip, user_agent)
    return {"token": token}


@router.get("/{conn_id}/{database}/apitokens/validate", dependencies=[Depends(rate_limit_validate)])
async def validate_token_endpoint(
    conn_id: str,
    database: str,
    authorization: Optional[str] = Header(None),
    session: AsyncSession = Depends(get_session),
):
    conn, secret = await _require_enabled(conn_id, database, session)
    if not authorization or not authorization.lower().startswith("bearer "):
        return {"valid": False}
    token = authorization.split(" ", 1)[1]
    return {"valid": papi_service.validate_token(conn, database, secret, token)}


async def _require_table_enabled(session: AsyncSession, conn: DbConnection, database: str, table: str) -> None:
    if not await papi_service.is_table_enabled(session, conn.id, database, table):
        raise HTTPException(status_code=404, detail=f"Generated API is not enabled for table '{table}'.")


@router.get("/{conn_id}/{database}/{table}")
async def list_rows(
    table: str,
    limit: int = 100,
    offset: int = 0,
    authed: tuple[DbConnection, str] = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    conn, database = authed
    await _require_table_enabled(session, conn, database, table)
    try:
        return {"rows": papi_service.list_rows(conn, database, table, min(limit, 1000), max(offset, 0))}
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{conn_id}/{database}/{table}/{guid}")
async def get_row(
    table: str,
    guid: str,
    authed: tuple[DbConnection, str] = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    conn, database = authed
    await _require_table_enabled(session, conn, database, table)
    try:
        row = papi_service.get_row(conn, database, table, guid)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if row is None:
        raise HTTPException(status_code=404, detail="Row not found.")
    return row


@router.post("/{conn_id}/{database}/{table}")
async def create_row(
    table: str,
    body: Dict[str, Any],
    authed: tuple[DbConnection, str] = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    conn, database = authed
    await _require_table_enabled(session, conn, database, table)
    try:
        return papi_service.create_row(conn, database, table, body)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.put("/{conn_id}/{database}/{table}/{guid}")
async def update_row(
    table: str,
    guid: str,
    body: Dict[str, Any],
    authed: tuple[DbConnection, str] = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    conn, database = authed
    await _require_table_enabled(session, conn, database, table)
    try:
        matched = papi_service.update_row(conn, database, table, guid, body)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not matched:
        raise HTTPException(status_code=404, detail="Row not found.")
    return {"message": "Updated."}


@router.delete("/{conn_id}/{database}/{table}/{guid}")
async def delete_row(
    table: str,
    guid: str,
    authed: tuple[DbConnection, str] = Depends(_authed_connection),
    session: AsyncSession = Depends(get_session),
):
    conn, database = authed
    await _require_table_enabled(session, conn, database, table)
    try:
        matched = papi_service.soft_delete_row(conn, database, table, guid)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if not matched:
        raise HTTPException(status_code=404, detail="Row not found.")
    return {"message": "Deleted (soft)."}
