import logging
import secrets
from typing import List, Optional, Set

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.anon_auth import get_auth_backend
from app.auth.permissions import require_admin
from app.database import get_session
from app.models.connection import ConnectionAccess, DbConnection
from app.models.user import User, UserRole
from app.routers._common import get_connection_or_404
from app.services import papi_service
from app.services.db_service import db_service

log = logging.getLogger("pilotbase")

router = APIRouter()

# ── Default connections (loaded from api/defaultConnections.py) ───────────────

_DEFAULT_CONFIGS: List[dict] = []
_default_names: Set[str] = set()
_defaults_seeded = False

try:
    import defaultConnections as _dc  # type: ignore[import]
    _DEFAULT_CONFIGS = list(_dc.DEFAULT_CONNECTIONS)
    _default_names = {c["name"] for c in _DEFAULT_CONFIGS}
    log.info(f"Loaded {len(_DEFAULT_CONFIGS)} default connection(s): {sorted(_default_names)}")
except ImportError:
    pass


async def _ensure_default_connections(admin_user: User, session: AsyncSession) -> None:
    global _defaults_seeded
    if _defaults_seeded or not _DEFAULT_CONFIGS:
        return
    for cfg in _DEFAULT_CONFIGS:
        name = cfg["name"]
        result = await session.execute(
            select(DbConnection).where(DbConnection.name == name, DbConnection.is_active == True)  # noqa: E712
        )
        if result.scalar_one_or_none():
            continue
        conn_id = secrets.token_hex(16)
        password = cfg.get("password")
        conn = DbConnection(
            id=conn_id,
            name=name,
            db_type=cfg["db_type"],
            host=cfg.get("host"),
            port=cfg.get("port"),
            database=cfg.get("database"),
            username=cfg.get("username"),
            password_encrypted=db_service.encrypt_password(password) if password else None,
            ssl_mode=cfg.get("ssl_mode"),
            extra_params=cfg.get("extra_params"),
            created_by=admin_user.id,
        )
        session.add(conn)
        session.add(ConnectionAccess(
            id=secrets.token_hex(16),
            connection_id=conn_id,
            user_id=admin_user.id,
            can_read=True,
            can_write=True,
            can_admin=True,
        ))
        log.info(f"Created default connection: {name}")
    await session.commit()
    _defaults_seeded = True


# ── Request / response models ─────────────────────────────────────────────────

class ConnectionCreate(BaseModel):
    user_anon_id: str
    user_email: Optional[str] = None
    name: str
    db_type: str
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_mode: Optional[str] = None
    extra_params: Optional[str] = None


class ConnectionUpdate(BaseModel):
    user_anon_id: str
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_mode: Optional[str] = None
    extra_params: Optional[str] = None


class ConnectionRequest(BaseModel):
    user_anon_id: str
    user_email: Optional[str] = None


class ConnectionTestParams(BaseModel):
    user_anon_id: str
    db_type: str
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    ssl_mode: Optional[str] = None
    extra_params: Optional[str] = None


class CreateDatabaseBody(BaseModel):
    user_anon_id: str
    db_name: str


class CreateUserBody(BaseModel):
    user_anon_id: str
    username: str
    password: str
    database: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/")
async def list_connections(
    user_anon_id: str,
    user_email: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    backend = get_auth_backend()
    user = await backend.get_or_create_user(session, user_anon_id, user_email)

    if user.role == UserRole.ADMIN:
        await _ensure_default_connections(user, session)
        result = await session.execute(select(DbConnection).where(DbConnection.is_active == True))  # noqa: E712
        conns = result.scalars().all()
    else:
        result = await session.execute(
            select(DbConnection)
            .join(ConnectionAccess, ConnectionAccess.connection_id == DbConnection.id)
            .where(ConnectionAccess.user_id == user.id, DbConnection.is_active == True)  # noqa: E712
        )
        conns = result.scalars().all()

    return [
        {
            "id": c.id,
            "name": c.name,
            "db_type": c.db_type,
            "host": c.host,
            "port": c.port,
            "database": c.database,
            "username": c.username,
            "ssl_mode": c.ssl_mode,
            "created_at": c.created_at,
            "is_default": c.name in _default_names,
        }
        for c in conns
    ]


@router.post("/test-params")
async def test_connection_params(
    body: ConnectionTestParams,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    ok, error, databases = await db_service.run_off_loop(
        db_service.test_connection_params,
        db_type=body.db_type,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password=body.password,
        ssl_mode=body.ssl_mode,
        extra_params=body.extra_params,
    )
    return {"success": ok, "error": error, "databases": databases}


@router.post("/")
async def create_connection(
    body: ConnectionCreate,
    session: AsyncSession = Depends(get_session),
):
    user = await require_admin(body.user_anon_id, session)
    conn_id = secrets.token_hex(16)
    encrypted_pw = db_service.encrypt_password(body.password) if body.password else None

    conn = DbConnection(
        id=conn_id,
        name=body.name,
        db_type=body.db_type,
        host=body.host,
        port=body.port,
        database=body.database,
        username=body.username,
        password_encrypted=encrypted_pw,
        ssl_mode=body.ssl_mode,
        extra_params=body.extra_params,
        created_by=user.id,
    )
    session.add(conn)

    access = ConnectionAccess(
        id=secrets.token_hex(16),
        connection_id=conn_id,
        user_id=user.id,
        can_read=True,
        can_write=True,
        can_admin=True,
    )
    session.add(access)
    await session.commit()

    return {"id": conn_id, "name": conn.name, "db_type": conn.db_type}


@router.put("/{conn_id}")
async def update_connection(
    conn_id: str,
    body: ConnectionUpdate,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")

    if body.name is not None:         conn.name = body.name
    if body.host is not None:         conn.host = body.host
    if body.port is not None:         conn.port = body.port
    if body.database is not None:     conn.database = body.database
    if body.username is not None:     conn.username = body.username
    if body.password is not None:     conn.password_encrypted = db_service.encrypt_password(body.password)
    if body.ssl_mode is not None:     conn.ssl_mode = body.ssl_mode
    if body.extra_params is not None: conn.extra_params = body.extra_params

    db_service.drop_engine(conn_id)
    await session.commit()
    return {"message": "Updated."}


@router.delete("/{conn_id}")
async def delete_connection(
    conn_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(user_anon_id, session)
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    if conn.name in _default_names:
        raise HTTPException(status_code=403, detail="Default connections cannot be deleted.")
    conn.is_active = False
    db_service.drop_engine(conn_id)
    await session.commit()
    return {"message": "Connection removed."}


@router.post("/{conn_id}/test")
async def test_connection(
    conn_id: str,
    body: ConnectionRequest,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    ok, error = await db_service.run_off_loop(db_service.test_connection_verbose, conn)
    return {"success": ok, "error": error}


@router.get("/{conn_id}/version")
async def get_db_version(
    conn_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    version = await db_service.run_off_loop(db_service.get_version, conn)
    return {"version": version}


@router.get("/{conn_id}/databases")
async def list_databases(
    conn_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    try:
        dbs = await db_service.run_off_loop(db_service.list_databases, conn)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"databases": dbs}


@router.get("/{conn_id}/objects")
async def list_objects(
    conn_id: str,
    user_anon_id: str,
    database: Optional[str] = None,
    schema: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    try:
        objects = await db_service.run_off_loop(db_service.list_objects, conn, schema, database)
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"objects": objects}


@router.get("/{conn_id}/table/{table_name}")
async def describe_table(
    conn_id: str,
    table_name: str,
    user_anon_id: str,
    schema: Optional[str] = None,
    database: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    info = await db_service.run_off_loop(db_service.describe_table, conn, table_name, schema, database)
    return info


@router.post("/{conn_id}/admin/create-database")
async def create_database(
    conn_id: str,
    body: CreateDatabaseBody,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    try:
        await db_service.run_off_loop(db_service.create_database, conn, body.db_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"Database '{body.db_name}' created successfully."}


@router.post("/{conn_id}/admin/create-user")
async def create_db_user(
    conn_id: str,
    body: CreateUserBody,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    result = await session.execute(select(DbConnection).where(DbConnection.id == conn_id))
    conn = result.scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="Connection not found.")
    try:
        await db_service.run_off_loop(db_service.create_db_user, conn, body.username, body.password, body.database)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"message": f"User '{body.username}' created successfully."}


# ── Generated CRUD API ("papi") enable/disable ────────────────────────────────
# Provisioning is admin-gated through the normal Pilotbase session; the
# generated API itself (app.routers.papi) uses a separate self-service JWT
# auth model once enabled.

@router.get("/{conn_id}/papi/status")
async def papi_status(
    conn_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    await get_connection_or_404(conn_id, session)
    return await papi_service.get_status(session, conn_id)


@router.post("/{conn_id}/papi/enable")
async def enable_papi(
    conn_id: str,
    body: ConnectionRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    conn = await get_connection_or_404(conn_id, session)
    try:
        await papi_service.enable_for_connection(session, conn)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await papi_service.get_status(session, conn_id)


@router.post("/{conn_id}/papi/disable")
async def disable_papi(
    conn_id: str,
    body: ConnectionRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    await get_connection_or_404(conn_id, session)
    await papi_service.disable_for_connection(session, conn_id)
    return await papi_service.get_status(session, conn_id)


# ── Generated CRUD API — per-table registry ───────────────────────────────────
# Enabling papi for a connection (above) makes every table CAPABLE of being
# served, but each one must still be individually activated here (or by the
# AI agent's enable_table_api tool, gated behind plan approval) before its
# rows are actually reachable through app.routers.papi.

@router.get("/{conn_id}/papi/tables")
async def papi_list_tables(
    conn_id: str,
    user_anon_id: str,
    session: AsyncSession = Depends(get_session),
):
    conn = await get_connection_or_404(conn_id, session)
    tables = papi_service.list_exposed_tables(conn)
    configs = {c.table_name: c for c in await papi_service.list_table_configs(session, conn_id)}
    return {
        "tables": [
            {
                "table": t,
                "enabled": configs[t].enabled if t in configs else False,
                "activated_by": configs[t].activated_by if t in configs else None,
                "created_at": configs[t].created_at.isoformat() if t in configs else None,
            }
            for t in tables
        ]
    }


@router.post("/{conn_id}/papi/tables/{table_name}/enable")
async def papi_enable_table(
    conn_id: str,
    table_name: str,
    body: ConnectionRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    conn = await get_connection_or_404(conn_id, session)
    status = await papi_service.get_status(session, conn_id)
    if not status["enabled"]:
        await papi_service.enable_for_connection(session, conn)
    try:
        await papi_service.enable_table(session, conn, table_name, body.user_anon_id)
    except papi_service.PapiError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"table": table_name, "enabled": True}


@router.post("/{conn_id}/papi/tables/{table_name}/disable")
async def papi_disable_table(
    conn_id: str,
    table_name: str,
    body: ConnectionRequest,
    session: AsyncSession = Depends(get_session),
):
    await require_admin(body.user_anon_id, session)
    await get_connection_or_404(conn_id, session)
    await papi_service.disable_table(session, conn_id, table_name)
    return {"table": table_name, "enabled": False}
