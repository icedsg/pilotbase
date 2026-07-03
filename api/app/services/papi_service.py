"""
Generated CRUD API ('papi') — Firebase-style REST access to a connection's
tables/collections. No FK or data validation is performed; this is a thin,
opinionated passthrough intended for developers who bring their own
validation/auth on top.

Enabling a connection (whole-database switch, not per-table):
  - adds guid / created_at / last_updated / is_deleted to every existing SQL
    table (Mongo collections are schemaless, so nothing to alter there)
  - creates a system `apitokens` table/collection used for auth

Auth is a self-service JWT session: anyone can call create_token to mint one
(rate-limited — see app.papi_ratelimit), then use it as a Bearer token on
every other papi call. validate_token checks both the JWT signature/expiry
and a revocation flag on the corresponding apitokens row, so tokens can be
revoked server-side even before they expire.
"""
import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.connection import DbConnection
from app.models.papi_config import PapiConfig
from app.services.db_service import MongoAdapter, SQLAdapter, db_service

_JWT_ALGO = "HS256"
_TOKEN_TTL_DAYS = 30
SYSTEM_COLUMNS = ("guid", "created_at", "last_updated", "is_deleted")

_IDENT_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class PapiError(Exception):
    """Raised for papi-specific failures (disabled, unsupported db_type, bad identifier)."""


def _validate_ident(name: str) -> str:
    if not _IDENT_RE.match(name):
        raise PapiError(f"Invalid identifier: {name!r}")
    return name


def _quote_ident(db_type: str, name: str) -> str:
    if db_type in ("mysql", "mariadb"):
        return f"`{name}`"
    if db_type == "mssql":
        return f"[{name}]"
    return f'"{name}"'


def _to_aware(dt: Any) -> datetime:
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── Per-dialect column types for the system columns ────────────────────────────

_SQL_COLUMN_TYPES = {
    "postgresql":  {"guid": "VARCHAR(36)", "ts": "TIMESTAMP",      "bool": "BOOLEAN",    "bool_default": "FALSE"},
    "mysql":       {"guid": "VARCHAR(36)", "ts": "TIMESTAMP NULL", "bool": "TINYINT(1)", "bool_default": "0"},
    "mariadb":     {"guid": "VARCHAR(36)", "ts": "TIMESTAMP NULL", "bool": "TINYINT(1)", "bool_default": "0"},
    "sqlite":      {"guid": "TEXT",        "ts": "TEXT",           "bool": "INTEGER",    "bool_default": "0"},
    "mssql":       {"guid": "VARCHAR(36)", "ts": "DATETIME2",      "bool": "BIT",        "bool_default": "0"},
}


def _col_types(db_type: str) -> Dict[str, str]:
    return _SQL_COLUMN_TYPES.get(db_type, _SQL_COLUMN_TYPES["postgresql"])


def _system_column_ddl(db_type: str, col: str) -> str:
    types = _col_types(db_type)
    ident = _quote_ident(db_type, col)
    if col == "guid":
        return f"{ident} {types['guid']}"
    if col in ("created_at", "last_updated"):
        return f"{ident} {types['ts']}"
    if col == "is_deleted":
        return f"{ident} {types['bool']} DEFAULT {types['bool_default']}"
    raise ValueError(col)


# ── Config lookup ───────────────────────────────────────────────────────────────

async def _get_config(session: AsyncSession, connection_id: str) -> Optional[PapiConfig]:
    result = await session.execute(select(PapiConfig).where(PapiConfig.connection_id == connection_id))
    return result.scalar_one_or_none()


async def get_status(session: AsyncSession, connection_id: str) -> Dict[str, Any]:
    cfg = await _get_config(session, connection_id)
    if not cfg:
        return {"connection_id": connection_id, "enabled": False, "enabled_at": None}
    return {"connection_id": connection_id, "enabled": cfg.enabled, "enabled_at": cfg.enabled_at}


async def get_secret(session: AsyncSession, connection_id: str) -> Optional[str]:
    cfg = await _get_config(session, connection_id)
    if not cfg or not cfg.enabled:
        return None
    return db_service.decrypt_password(cfg.jwt_secret_encrypted)


# ── Enable / disable ─────────────────────────────────────────────────────────────

def _provision_sql_tables(conn: DbConnection) -> None:
    from sqlalchemy import inspect as sa_inspect, text
    engine = db_service.get_engine(conn)
    inspector = sa_inspect(engine)
    with engine.begin() as c:
        for table in inspector.get_table_names():
            existing = {col["name"] for col in inspector.get_columns(table)}
            missing = [col for col in SYSTEM_COLUMNS if col not in existing]
            for col in missing:
                ddl = _system_column_ddl(conn.db_type, col)
                c.execute(text(f'ALTER TABLE {_quote_ident(conn.db_type, table)} ADD COLUMN {ddl}'))


def _ensure_sql_apitokens_table(conn: DbConnection) -> None:
    from sqlalchemy import inspect as sa_inspect, text
    engine = db_service.get_engine(conn)
    inspector = sa_inspect(engine)
    if "apitokens" in inspector.get_table_names():
        return
    types = _col_types(conn.db_type)
    ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
    ddl = (
        f'CREATE TABLE {ident("apitokens")} ('
        f'{ident("id")} VARCHAR(36) PRIMARY KEY, '
        f'{ident("created_at")} {types["ts"]}, '
        f'{ident("expires_at")} {types["ts"]}, '
        f'{ident("revoked")} {types["bool"]} DEFAULT {types["bool_default"]}, '
        f'{ident("ip")} VARCHAR(64), '
        f'{ident("user_agent")} VARCHAR(255)'
        f')'
    )
    with engine.begin() as c:
        c.execute(text(ddl))


def _ensure_mongo_apitokens_collection(conn: DbConnection) -> None:
    client, db_name = db_service.get_mongo_client(conn)
    if "apitokens" not in client[db_name].list_collection_names():
        client[db_name].create_collection("apitokens")


async def enable_for_connection(session: AsyncSession, conn: DbConnection) -> None:
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        _provision_sql_tables(conn)
        _ensure_sql_apitokens_table(conn)
    elif isinstance(adapter, MongoAdapter):
        _ensure_mongo_apitokens_collection(conn)
    else:
        raise PapiError(f"Generated API is not supported for {conn.db_type}")

    cfg = await _get_config(session, conn.id)
    encrypted = db_service.encrypt_password(secrets.token_urlsafe(48))
    if cfg:
        cfg.enabled = True
        cfg.jwt_secret_encrypted = encrypted
        cfg.enabled_at = datetime.now(timezone.utc)
    else:
        cfg = PapiConfig(connection_id=conn.id, enabled=True, jwt_secret_encrypted=encrypted)
        session.add(cfg)
    await session.commit()


async def disable_for_connection(session: AsyncSession, connection_id: str) -> None:
    cfg = await _get_config(session, connection_id)
    if cfg:
        cfg.enabled = False
        await session.commit()


def list_exposed_tables(conn: DbConnection) -> List[str]:
    objects = db_service.list_objects(conn)
    return sorted(o["name"] for o in objects if o["type"] in ("table", "collection") and o["name"] != "apitokens")


# ── Auth: create_token / validate_token ──────────────────────────────────────────

def _insert_apitoken_row(conn: DbConnection, jti: str, created_at: datetime, expires_at: datetime,
                          ip: Optional[str], user_agent: Optional[str]) -> None:
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        with engine.begin() as c:
            c.execute(text(
                f'INSERT INTO {ident("apitokens")} '
                f'({ident("id")}, {ident("created_at")}, {ident("expires_at")}, {ident("revoked")}, {ident("ip")}, {ident("user_agent")}) '
                f'VALUES (:id, :created_at, :expires_at, 0, :ip, :user_agent)'
            ), {"id": jti, "created_at": created_at, "expires_at": expires_at, "ip": ip or "", "user_agent": user_agent or ""})
    elif isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        client[db_name]["apitokens"].insert_one({
            "_id": jti, "created_at": created_at, "expires_at": expires_at,
            "revoked": False, "ip": ip or "", "user_agent": user_agent or "",
        })
    else:
        raise PapiError(f"Generated API is not supported for {conn.db_type}")


def create_token(conn: DbConnection, secret: str, ip: Optional[str], user_agent: Optional[str]) -> str:
    jti = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_TOKEN_TTL_DAYS)
    _insert_apitoken_row(conn, jti, now, expires_at, ip, user_agent)
    payload = {"jti": jti, "conn_id": conn.id, "iat": int(now.timestamp()), "exp": int(expires_at.timestamp())}
    return jwt.encode(payload, secret, algorithm=_JWT_ALGO)


def _lookup_apitoken_valid(conn: DbConnection, jti: str) -> bool:
    adapter = db_service.get_adapter(conn)
    now = datetime.now(timezone.utc)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        with engine.connect() as c:
            row = c.execute(text(
                f'SELECT {ident("revoked")}, {ident("expires_at")} FROM {ident("apitokens")} WHERE {ident("id")} = :id'
            ), {"id": jti}).fetchone()
        if not row:
            return False
        revoked, expires_at = row[0], row[1]
        if revoked:
            return False
        if expires_at and _to_aware(expires_at) < now:
            return False
        return True
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        doc = client[db_name]["apitokens"].find_one({"_id": jti})
        if not doc or doc.get("revoked"):
            return False
        expires_at = doc.get("expires_at")
        if expires_at and _to_aware(expires_at) < now:
            return False
        return True
    return False


def validate_token(conn: DbConnection, secret: str, token: str) -> bool:
    try:
        payload = jwt.decode(token, secret, algorithms=[_JWT_ALGO])
    except JWTError:
        return False
    if payload.get("conn_id") != conn.id:
        return False
    jti = payload.get("jti")
    if not jti:
        return False
    return _lookup_apitoken_valid(conn, jti)


# ── CRUD passthrough ──────────────────────────────────────────────────────────────

def _select_all_sql(db_type: str, table: str, limit: int, offset: int) -> str:
    ident = lambda n: _quote_ident(db_type, n)  # noqa: E731
    where_order = f'WHERE {ident("is_deleted")} = 0 ORDER BY {ident("created_at")}'
    if db_type == "mssql":
        return f'SELECT * FROM {ident(table)} {where_order} OFFSET {int(offset)} ROWS FETCH NEXT {int(limit)} ROWS ONLY'
    return f'SELECT * FROM {ident(table)} {where_order} LIMIT {int(limit)} OFFSET {int(offset)}'


def list_rows(conn: DbConnection, table: str, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    _validate_ident(table)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        with engine.connect() as c:
            rows = c.execute(text(_select_all_sql(conn.db_type, table, limit, offset)))
            return [dict(r._mapping) for r in rows]
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        docs = list(client[db_name][table].find({"is_deleted": False}).skip(offset).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def get_row(conn: DbConnection, table: str, guid: str) -> Optional[Dict[str, Any]]:
    _validate_ident(table)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        with engine.connect() as c:
            row = c.execute(text(f'SELECT * FROM {ident(table)} WHERE {ident("guid")} = :guid'), {"guid": guid}).fetchone()
        return dict(row._mapping) if row else None
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        doc = client[db_name][table].find_one({"guid": guid})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def create_row(conn: DbConnection, table: str, body: Dict[str, Any]) -> Dict[str, Any]:
    _validate_ident(table)
    now = datetime.now(timezone.utc)
    row = dict(body)
    row.setdefault("guid", str(uuid.uuid4()))
    row["created_at"] = now
    row["last_updated"] = now
    row["is_deleted"] = False

    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        cols = [_validate_ident(k) for k in row]
        col_list = ", ".join(ident(c) for c in cols)
        placeholders = ", ".join(f":{c}" for c in cols)
        with engine.begin() as c:
            c.execute(text(f'INSERT INTO {ident(table)} ({col_list}) VALUES ({placeholders})'), row)
        return row
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        client[db_name][table].insert_one(dict(row))
        return row
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def update_row(conn: DbConnection, table: str, guid: str, body: Dict[str, Any]) -> int:
    """Returns the number of matched rows (0 if the guid doesn't exist)."""
    _validate_ident(table)
    row = {k: v for k, v in body.items() if k not in ("guid", "created_at")}
    row["last_updated"] = datetime.now(timezone.utc)

    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        cols = [_validate_ident(k) for k in row]
        set_clause = ", ".join(f'{ident(c)} = :{c}' for c in cols)
        params = dict(row)
        params["_guid"] = guid
        with engine.begin() as c:
            result = c.execute(text(f'UPDATE {ident(table)} SET {set_clause} WHERE {ident("guid")} = :_guid'), params)
            return result.rowcount
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        result = client[db_name][table].update_one({"guid": guid}, {"$set": row})
        return result.matched_count
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def soft_delete_row(conn: DbConnection, table: str, guid: str) -> int:
    """Sets is_deleted = true; never physically removes the row. Returns matched count."""
    _validate_ident(table)
    now = datetime.now(timezone.utc)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine = db_service.get_engine(conn)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        with engine.begin() as c:
            result = c.execute(text(
                f'UPDATE {ident(table)} SET {ident("is_deleted")} = 1, {ident("last_updated")} = :now WHERE {ident("guid")} = :guid'
            ), {"now": now, "guid": guid})
            return result.rowcount
    if isinstance(adapter, MongoAdapter):
        client, db_name = db_service.get_mongo_client(conn)
        result = client[db_name][table].update_one({"guid": guid}, {"$set": {"is_deleted": True, "last_updated": now}})
        return result.matched_count
    raise PapiError(f"Generated API is not supported for {conn.db_type}")
