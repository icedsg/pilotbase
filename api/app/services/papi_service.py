"""
Generated CRUD API ('papi') — Firebase-style REST access to a connection's
tables/collections. No FK or data validation is performed; this is a thin,
opinionated passthrough intended for developers who bring their own
validation/auth on top.

Enabling one database on a connection (whole-database switch, not per-table —
a connection can browse several databases, so this is scoped to a single
(connection_id, database) pair rather than the connection as a whole):
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
from app.models.papi_table_config import PapiTableConfig
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


# ── Cross-database targeting ─────────────────────────────────────────────────
# A single connection can browse multiple databases (db_service.list_objects/
# execute_query take a per-call `database` override for exactly this reason),
# so every papi operation is scoped to an explicit `database` argument rather
# than trusting whatever `conn.database` happened to be set to when the
# connection was created. Mirrors the temp-engine pattern already used by
# SQLAdapter.list_objects/describe_table/execute_query in db_service.py.

_SCOPED_ENGINE_DIALECTS = ("postgresql", "mssql", "db2", "cockroachdb", "snowflake")


def _scoped_engine(conn: DbConnection, database: str):
    """Returns (engine, is_temporary). Caller must .dispose() the engine when
    is_temporary is True."""
    from sqlalchemy import create_engine
    base_engine = db_service.get_engine(conn)
    if conn.db_type in _SCOPED_ENGINE_DIALECTS:
        return create_engine(base_engine.url.set(database=database), pool_pre_ping=True), True
    return base_engine, False


def _qualified_table(conn: DbConnection, database: str, table: str) -> str:
    """For MySQL/MariaDB, `_scoped_engine` can't redirect an existing engine to
    another database (unlike Postgres/MSSQL, whose URL can just be re-pointed),
    so table references are qualified with the database name instead — same
    convention `execute_query` documents for MySQL elsewhere in db_service.py."""
    if conn.db_type in ("mysql", "mariadb"):
        _validate_ident(database)
        return f"{_quote_ident(conn.db_type, database)}.{_quote_ident(conn.db_type, table)}"
    return _quote_ident(conn.db_type, table)


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
    "duckdb":      {"guid": "VARCHAR(36)", "ts": "TIMESTAMP",      "bool": "BOOLEAN",    "bool_default": "FALSE"},
    "mssql":       {"guid": "VARCHAR(36)", "ts": "DATETIME2",      "bool": "BIT",        "bool_default": "0"},
}


def _col_types(db_type: str) -> Dict[str, str]:
    return _SQL_COLUMN_TYPES.get(db_type, _SQL_COLUMN_TYPES["postgresql"])


def _bool_literal(db_type: str, value: bool) -> str:
    """Postgres rejects bare 0/1 against a real boolean column (`operator does
    not exist: boolean = integer`) — every other dialect here uses an
    integer-backed bool column (TINYINT/BIT/INTEGER) and accepts 0/1 fine."""
    if db_type in ("postgresql", "duckdb"):
        return "TRUE" if value else "FALSE"
    return "1" if value else "0"


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

async def _get_config(session: AsyncSession, connection_id: str, database: str) -> Optional[PapiConfig]:
    result = await session.execute(
        select(PapiConfig).where(PapiConfig.connection_id == connection_id, PapiConfig.database == database)
    )
    return result.scalar_one_or_none()


async def get_status(session: AsyncSession, connection_id: str, database: str) -> Dict[str, Any]:
    cfg = await _get_config(session, connection_id, database)
    if not cfg:
        return {"connection_id": connection_id, "database": database, "enabled": False, "enabled_at": None}
    return {"connection_id": connection_id, "database": database, "enabled": cfg.enabled, "enabled_at": cfg.enabled_at}


async def get_secret(session: AsyncSession, connection_id: str, database: str) -> Optional[str]:
    cfg = await _get_config(session, connection_id, database)
    if not cfg or not cfg.enabled:
        return None
    return db_service.decrypt_password(cfg.jwt_secret_encrypted)


# ── Enable / disable ─────────────────────────────────────────────────────────────

def _provision_sql_tables(conn: DbConnection, database: str) -> None:
    from sqlalchemy import inspect as sa_inspect, text
    engine, is_temp = _scoped_engine(conn, database)
    schema = database if conn.db_type in ("mysql", "mariadb") else None
    try:
        inspector = sa_inspect(engine)
        with engine.begin() as c:
            for table in inspector.get_table_names(schema=schema):
                existing = {col["name"] for col in inspector.get_columns(table, schema=schema)}
                missing = [col for col in SYSTEM_COLUMNS if col not in existing]
                for col in missing:
                    ddl = _system_column_ddl(conn.db_type, col)
                    c.execute(text(f'ALTER TABLE {_qualified_table(conn, database, table)} ADD COLUMN {ddl}'))
    finally:
        if is_temp:
            engine.dispose()


def _ensure_sql_apitokens_table(conn: DbConnection, database: str) -> None:
    from sqlalchemy import inspect as sa_inspect, text
    engine, is_temp = _scoped_engine(conn, database)
    schema = database if conn.db_type in ("mysql", "mariadb") else None
    try:
        inspector = sa_inspect(engine)
        if "apitokens" in inspector.get_table_names(schema=schema):
            return
        types = _col_types(conn.db_type)
        ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
        table = _qualified_table(conn, database, "apitokens")
        ddl = (
            f'CREATE TABLE {table} ('
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
    finally:
        if is_temp:
            engine.dispose()


def _ensure_mongo_apitokens_collection(conn: DbConnection, database: str) -> None:
    client, _ = db_service.get_mongo_client(conn)
    if "apitokens" not in client[database].list_collection_names():
        client[database].create_collection("apitokens")


async def enable_for_connection(session: AsyncSession, conn: DbConnection, database: str) -> None:
    _validate_ident(database)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        _provision_sql_tables(conn, database)
        _ensure_sql_apitokens_table(conn, database)
    elif isinstance(adapter, MongoAdapter):
        _ensure_mongo_apitokens_collection(conn, database)
    else:
        raise PapiError(f"Generated API is not supported for {conn.db_type}")

    cfg = await _get_config(session, conn.id, database)
    encrypted = db_service.encrypt_password(secrets.token_urlsafe(48))
    if cfg:
        cfg.enabled = True
        cfg.jwt_secret_encrypted = encrypted
        cfg.enabled_at = datetime.now(timezone.utc)
    else:
        cfg = PapiConfig(connection_id=conn.id, database=database, enabled=True, jwt_secret_encrypted=encrypted)
        session.add(cfg)
    await session.commit()


async def disable_for_connection(session: AsyncSession, connection_id: str, database: str) -> None:
    cfg = await _get_config(session, connection_id, database)
    if cfg:
        cfg.enabled = False
        await session.commit()


def list_exposed_tables(conn: DbConnection, database: str) -> List[str]:
    objects = db_service.list_objects(conn, database=database)
    return sorted(o["name"] for o in objects if o["type"] in ("table", "collection") and o["name"] != "apitokens")


# ── Per-table registry ───────────────────────────────────────────────────────────
# Enabling papi for a connection (above) provisions every table so any of them
# CAN be served, but doesn't mean any of them SHOULD be — this registry is the
# record of which tables were actually, deliberately activated, and is what
# papi.py's CRUD routes check before serving a table.

async def _get_table_config(
    session: AsyncSession, connection_id: str, database: str, table_name: str,
) -> Optional[PapiTableConfig]:
    result = await session.execute(
        select(PapiTableConfig).where(
            PapiTableConfig.connection_id == connection_id,
            PapiTableConfig.database == database,
            PapiTableConfig.table_name == table_name,
        )
    )
    return result.scalar_one_or_none()


async def enable_table(
    session: AsyncSession, conn: DbConnection, database: str, table_name: str, activated_by: Optional[str],
) -> PapiTableConfig:
    _validate_ident(table_name)
    if table_name not in list_exposed_tables(conn, database):
        raise PapiError(f"Table '{table_name}' not found in database '{database}' on this connection.")

    cfg = await _get_table_config(session, conn.id, database, table_name)
    if cfg:
        cfg.enabled = True
    else:
        cfg = PapiTableConfig(
            connection_id=conn.id, database=database, table_name=table_name, enabled=True, activated_by=activated_by,
        )
        session.add(cfg)
    await session.commit()
    await session.refresh(cfg)
    return cfg


async def disable_table(session: AsyncSession, connection_id: str, database: str, table_name: str) -> None:
    cfg = await _get_table_config(session, connection_id, database, table_name)
    if cfg:
        cfg.enabled = False
        await session.commit()


async def list_table_configs(session: AsyncSession, connection_id: str, database: str) -> List[PapiTableConfig]:
    result = await session.execute(
        select(PapiTableConfig).where(
            PapiTableConfig.connection_id == connection_id, PapiTableConfig.database == database,
        )
    )
    return list(result.scalars().all())


async def is_table_enabled(session: AsyncSession, connection_id: str, database: str, table_name: str) -> bool:
    cfg = await _get_table_config(session, connection_id, database, table_name)
    return bool(cfg and cfg.enabled)


# ── Auth: create_token / validate_token ──────────────────────────────────────────

def _insert_apitoken_row(conn: DbConnection, database: str, jti: str, created_at: datetime, expires_at: datetime,
                          ip: Optional[str], user_agent: Optional[str]) -> None:
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            table = _qualified_table(conn, database, "apitokens")
            not_revoked = _bool_literal(conn.db_type, False)
            with engine.begin() as c:
                c.execute(text(
                    f'INSERT INTO {table} '
                    f'({ident("id")}, {ident("created_at")}, {ident("expires_at")}, {ident("revoked")}, {ident("ip")}, {ident("user_agent")}) '
                    f'VALUES (:id, :created_at, :expires_at, {not_revoked}, :ip, :user_agent)'
                ), {"id": jti, "created_at": created_at, "expires_at": expires_at, "ip": ip or "", "user_agent": user_agent or ""})
        finally:
            if is_temp:
                engine.dispose()
    elif isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        client[database]["apitokens"].insert_one({
            "_id": jti, "created_at": created_at, "expires_at": expires_at,
            "revoked": False, "ip": ip or "", "user_agent": user_agent or "",
        })
    else:
        raise PapiError(f"Generated API is not supported for {conn.db_type}")


def create_token(conn: DbConnection, database: str, secret: str, ip: Optional[str], user_agent: Optional[str]) -> str:
    jti = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(days=_TOKEN_TTL_DAYS)
    _insert_apitoken_row(conn, database, jti, now, expires_at, ip, user_agent)
    payload = {
        "jti": jti, "conn_id": conn.id, "database": database,
        "iat": int(now.timestamp()), "exp": int(expires_at.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm=_JWT_ALGO)


def _lookup_apitoken_valid(conn: DbConnection, database: str, jti: str) -> bool:
    adapter = db_service.get_adapter(conn)
    now = datetime.now(timezone.utc)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            table = _qualified_table(conn, database, "apitokens")
            with engine.connect() as c:
                row = c.execute(text(
                    f'SELECT {ident("revoked")}, {ident("expires_at")} FROM {table} WHERE {ident("id")} = :id'
                ), {"id": jti}).fetchone()
        finally:
            if is_temp:
                engine.dispose()
        if not row:
            return False
        revoked, expires_at = row[0], row[1]
        if revoked:
            return False
        if expires_at and _to_aware(expires_at) < now:
            return False
        return True
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        doc = client[database]["apitokens"].find_one({"_id": jti})
        if not doc or doc.get("revoked"):
            return False
        expires_at = doc.get("expires_at")
        if expires_at and _to_aware(expires_at) < now:
            return False
        return True
    return False


def validate_token(conn: DbConnection, database: str, secret: str, token: str) -> bool:
    try:
        payload = jwt.decode(token, secret, algorithms=[_JWT_ALGO])
    except JWTError:
        return False
    if payload.get("conn_id") != conn.id or payload.get("database") != database:
        return False
    jti = payload.get("jti")
    if not jti:
        return False
    return _lookup_apitoken_valid(conn, database, jti)


# ── CRUD passthrough ──────────────────────────────────────────────────────────────

def _select_all_sql(conn: DbConnection, database: str, table: str, limit: int, offset: int) -> str:
    ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
    qtable = _qualified_table(conn, database, table)
    where_order = f'WHERE {ident("is_deleted")} = {_bool_literal(conn.db_type, False)} ORDER BY {ident("created_at")}'
    if conn.db_type == "mssql":
        return f'SELECT * FROM {qtable} {where_order} OFFSET {int(offset)} ROWS FETCH NEXT {int(limit)} ROWS ONLY'
    return f'SELECT * FROM {qtable} {where_order} LIMIT {int(limit)} OFFSET {int(offset)}'


def list_rows(conn: DbConnection, database: str, table: str, limit: int = 100, offset: int = 0) -> List[Dict[str, Any]]:
    _validate_ident(table)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            with engine.connect() as c:
                rows = c.execute(text(_select_all_sql(conn, database, table, limit, offset)))
                return [dict(r._mapping) for r in rows]
        finally:
            if is_temp:
                engine.dispose()
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        docs = list(client[database][table].find({"is_deleted": False}).skip(offset).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def get_row(conn: DbConnection, database: str, table: str, guid: str) -> Optional[Dict[str, Any]]:
    _validate_ident(table)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            qtable = _qualified_table(conn, database, table)
            with engine.connect() as c:
                row = c.execute(text(f'SELECT * FROM {qtable} WHERE {ident("guid")} = :guid'), {"guid": guid}).fetchone()
            return dict(row._mapping) if row else None
        finally:
            if is_temp:
                engine.dispose()
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        doc = client[database][table].find_one({"guid": guid})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def create_row(conn: DbConnection, database: str, table: str, body: Dict[str, Any]) -> Dict[str, Any]:
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
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            qtable = _qualified_table(conn, database, table)
            cols = [_validate_ident(k) for k in row]
            col_list = ", ".join(ident(c) for c in cols)
            placeholders = ", ".join(f":{c}" for c in cols)
            with engine.begin() as c:
                c.execute(text(f'INSERT INTO {qtable} ({col_list}) VALUES ({placeholders})'), row)
            return row
        finally:
            if is_temp:
                engine.dispose()
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        client[database][table].insert_one(dict(row))
        return row
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def update_row(conn: DbConnection, database: str, table: str, guid: str, body: Dict[str, Any]) -> int:
    """Returns the number of matched rows (0 if the guid doesn't exist)."""
    _validate_ident(table)
    row = {k: v for k, v in body.items() if k not in ("guid", "created_at")}
    row["last_updated"] = datetime.now(timezone.utc)

    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            qtable = _qualified_table(conn, database, table)
            cols = [_validate_ident(k) for k in row]
            set_clause = ", ".join(f'{ident(c)} = :{c}' for c in cols)
            params = dict(row)
            params["_guid"] = guid
            with engine.begin() as c:
                result = c.execute(text(f'UPDATE {qtable} SET {set_clause} WHERE {ident("guid")} = :_guid'), params)
                return result.rowcount
        finally:
            if is_temp:
                engine.dispose()
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        result = client[database][table].update_one({"guid": guid}, {"$set": row})
        return result.matched_count
    raise PapiError(f"Generated API is not supported for {conn.db_type}")


def soft_delete_row(conn: DbConnection, database: str, table: str, guid: str) -> int:
    """Sets is_deleted = true; never physically removes the row. Returns matched count."""
    _validate_ident(table)
    now = datetime.now(timezone.utc)
    adapter = db_service.get_adapter(conn)
    if isinstance(adapter, SQLAdapter):
        from sqlalchemy import text
        engine, is_temp = _scoped_engine(conn, database)
        try:
            ident = lambda n: _quote_ident(conn.db_type, n)  # noqa: E731
            qtable = _qualified_table(conn, database, table)
            is_deleted_true = _bool_literal(conn.db_type, True)
            with engine.begin() as c:
                result = c.execute(text(
                    f'UPDATE {qtable} SET {ident("is_deleted")} = {is_deleted_true}, {ident("last_updated")} = :now WHERE {ident("guid")} = :guid'
                ), {"now": now, "guid": guid})
                return result.rowcount
        finally:
            if is_temp:
                engine.dispose()
    if isinstance(adapter, MongoAdapter):
        client, _ = db_service.get_mongo_client(conn)
        result = client[database][table].update_one({"guid": guid}, {"$set": {"is_deleted": True, "last_updated": now}})
        return result.matched_count
    raise PapiError(f"Generated API is not supported for {conn.db_type}")
