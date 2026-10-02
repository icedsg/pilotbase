"""
MCP server exposing Pilotbase's database-management features (everything
except the built-in AI assistant) as tools, so an external agent such as a
Claude Cowork skill can explore databases through Pilotbase.

Tools call the existing router functions directly rather than re-implementing
their logic, so permission checks and error handling stay in one place.
Mutating tools are only registered when settings.mcp_allow_writes is set;
otherwise `run_query` is restricted to read-only statements.

Served at /mcp on the main app (see main.py), behind LocalTokenMiddleware.
Desktop clients reach it through the stdio bridge in app/mcp/bridge.py.
"""
from typing import Any, Dict, List, Literal, Optional

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.tools.query_tools import _is_read_only
from app.auth.anon_auth import get_auth_backend
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.user import User, UserRole
from app.routers import backup, connections, export, migration, papi, query as query_router, vector
from app.routers._common import get_connection_or_404
from app.services import history_service
from app.services.db_service import NOSQL_READONLY_TYPES, describe_query_format

mcp = MCPServer(
    name="pilotbase",
    instructions=(
        "Pilotbase is a database manager. Start with list_connections to get a "
        "connection_id, then list_databases / list_schemas / list_objects / "
        "describe_table to explore, and run_query to read data. For non-SQL "
        "connections, call query_format first to learn the expected query shape."
        + ("" if settings.mcp_allow_writes else
           " This server is read-only: run_query only accepts SELECT/WITH/SHOW/EXPLAIN/DESCRIBE.")
    ),
)

_READ = ToolAnnotations(readOnlyHint=True)
_WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=True)


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _user_id(session: AsyncSession) -> str:
    """The Pilotbase identity MCP calls act as: MCP_USER_ANON_ID if set, else
    the first admin (the desktop app's single local user). On a fresh install
    with no users yet, an "mcp" user is created — the first user is admin."""
    if settings.mcp_user_anon_id:
        return settings.mcp_user_anon_id
    result = await session.execute(
        select(User.id).where(User.role == UserRole.ADMIN, User.is_active == True)  # noqa: E712
        .order_by(User.created_at).limit(1)
    )
    uid = result.scalar_one_or_none()
    if uid:
        return uid
    user = await get_auth_backend().get_or_create_user(session, "mcp")
    return user.id


async def _call(fn, *args, **kwargs) -> Any:
    """Invoke a router function with a fresh DB session. `user_anon_id=None` is
    filled in with the MCP identity, and `_body` is a factory taking that
    identity and returning the request model. HTTPExceptions become tool errors."""
    async with AsyncSessionLocal() as session:
        try:
            if "user_anon_id" in kwargs and kwargs["user_anon_id"] is None:
                kwargs["user_anon_id"] = await _user_id(session)
            body_factory = kwargs.pop("_body", None)
            if body_factory is not None:
                kwargs["body"] = body_factory(await _user_id(session))
            result = await fn(*args, session=session, **kwargs)
        except HTTPException as e:
            raise ToolError(str(e.detail))
    return jsonable_encoder(result)


# ── Read tools ────────────────────────────────────────────────────────────────

@mcp.tool(annotations=_READ)
async def list_connections() -> dict:
    """List the database connections saved in Pilotbase (id, name, db_type, host, default database)."""
    return {"connections": await _call(connections.list_connections, user_anon_id=None, user_email=None)}


@mcp.tool(annotations=_READ)
async def test_connection(connection_id: str) -> dict:
    """Check whether Pilotbase can reach a saved connection."""
    return await _call(
        connections.test_connection, connection_id,
        _body=lambda uid: connections.ConnectionRequest(user_anon_id=uid),
    )


@mcp.tool(annotations=_READ)
async def get_server_version(connection_id: str) -> dict:
    """Return the database server version for a connection."""
    return await _call(connections.get_db_version, connection_id, user_anon_id=None)


@mcp.tool(annotations=_READ)
async def list_databases(connection_id: str) -> Any:
    """List databases available on a connection's server."""
    return await _call(connections.list_databases, connection_id, user_anon_id=None)


@mcp.tool(annotations=_READ)
async def list_schemas(connection_id: str, database: Optional[str] = None) -> Any:
    """List schemas in a database (defaults to the connection's own database)."""
    return await _call(connections.list_schemas, connection_id, user_anon_id=None, database=database)


@mcp.tool(annotations=_READ)
async def list_objects(connection_id: str, database: Optional[str] = None, schema: Optional[str] = None) -> Any:
    """List tables, views and other objects (or collections/keys/indexes for NoSQL and vector DBs)."""
    return await _call(connections.list_objects, connection_id, user_anon_id=None, database=database, schema=schema)


@mcp.tool(annotations=_READ)
async def describe_table(
    connection_id: str, table_name: str, schema: Optional[str] = None, database: Optional[str] = None,
) -> Any:
    """Describe a table's columns, types, keys and indexes."""
    return await _call(
        connections.describe_table, connection_id, table_name,
        user_anon_id=None, schema=schema, database=database,
    )


@mcp.tool(annotations=_READ)
async def query_format(connection_id: str) -> dict:
    """Explain the query format a connection expects. SQL databases take plain SQL;
    NoSQL and vector databases take a JSON (or command) format described here."""
    async with AsyncSessionLocal() as session:
        try:
            conn = await get_connection_or_404(connection_id, session)
        except HTTPException as e:
            raise ToolError(str(e.detail))
    return {"db_type": conn.db_type, "format": describe_query_format(conn.db_type) or "SQL / native command text"}


@mcp.tool(annotations=_READ if not settings.mcp_allow_writes else _WRITE)
async def run_query(
    connection_id: str, query: str, database: Optional[str] = None,
    params: Optional[Dict[str, Any]] = None, limit: int = 1000,
) -> dict:
    """Run a query against a connection and return columns and rows (capped at `limit`).
    Use query_format first for non-SQL connections."""
    if not settings.mcp_allow_writes:
        async with AsyncSessionLocal() as session:
            try:
                conn = await get_connection_or_404(connection_id, session)
            except HTTPException as e:
                raise ToolError(str(e.detail))
        if conn.db_type not in NOSQL_READONLY_TYPES and not _is_read_only(query):
            raise ToolError(
                "Pilotbase MCP is read-only: only SELECT/WITH/SHOW/EXPLAIN/DESCRIBE are allowed. "
                "Set MCP_ALLOW_WRITES=true to enable writes."
            )
    return await _call(
        query_router.execute_query,
        _body=lambda uid: query_router.QueryRequest(
            user_anon_id=uid, connection_id=connection_id, query=query,
            params=params, limit=limit, database=database,
        ),
    )


@mcp.tool(annotations=_READ)
async def query_history(limit: int = 50) -> dict:
    """Recent queries run through Pilotbase (by the UI, the AI assistant or MCP)."""
    return jsonable_encoder({"entries": history_service.list_recent(min(limit, 1000))})


@mcp.tool(annotations=_READ)
async def export_sql(
    connection_id: str, tables: List[str], database: Optional[str] = None,
    create_table: bool = True, drop_if_exists: bool = False, include_inserts: bool = False,
) -> dict:
    """Generate a SQL script (CREATE TABLE and optionally INSERTs) for the given tables. Does not modify anything."""
    return await _call(
        export.export_sql,
        _body=lambda uid: export.ExportSqlRequest(
            user_anon_id=uid, connection_id=connection_id, database=database, tables=tables,
            create_table=create_table, drop_if_exists=drop_if_exists, include_inserts=include_inserts,
        ),
    )


@mcp.tool(annotations=_READ)
async def schema_diff(source_connection_id: str, target_connection_id: str, schema: Optional[str] = None) -> dict:
    """Compare the schemas of two connections and report added/removed/changed tables and columns."""
    return await _call(
        migration.schema_diff,
        _body=lambda uid: migration.DiffRequest(
            user_anon_id=uid, source_connection_id=source_connection_id,
            target_connection_id=target_connection_id, schema=schema,
        ),
    )


@mcp.tool(annotations=_READ)
async def migration_script(
    source_connection_id: str, target_connection_id: str,
    schema: Optional[str] = None, dialect: str = "postgresql",
) -> dict:
    """Generate (but do not run) SQL that would migrate the target schema to match the source."""
    return await _call(
        migration.migration_script,
        _body=lambda uid: migration.ScriptRequest(
            user_anon_id=uid, source_connection_id=source_connection_id,
            target_connection_id=target_connection_id, schema=schema, dialect=dialect,
        ),
    )


@mcp.tool(annotations=_READ)
async def migration_objects(source_connection_id: str, target_connection_id: str, schema: Optional[str] = None) -> Any:
    """List objects in source vs target with their migration status (new / changed / identical)."""
    return await _call(
        migration.migration_objects,
        _body=lambda uid: migration.ObjectsRequest(
            user_anon_id=uid, source_connection_id=source_connection_id,
            target_connection_id=target_connection_id, schema=schema,
        ),
    )


@mcp.tool(annotations=_READ)
async def migration_plan(
    source_connection_id: str, target_connection_id: str, object_names: List[str],
    scope: Literal["schema", "schema_data"] = "schema", schema: Optional[str] = None,
) -> Any:
    """Build (but do not run) a migration plan for the chosen objects."""
    return await _call(
        migration.migration_plan,
        _body=lambda uid: migration.PlanRequest(
            user_anon_id=uid, source_connection_id=source_connection_id,
            target_connection_id=target_connection_id, schema=schema,
            object_names=object_names, scope=scope,
        ),
    )


@mcp.tool(annotations=_READ)
async def migration_job_status(job_id: str) -> Any:
    """Progress of a migration job started with migration_execute."""
    return await _call(migration.migration_job_status, job_id, user_anon_id=None)


@mcp.tool(annotations=_READ)
async def list_backups(connection_name: str = "") -> dict:
    """List backup files Pilotbase has created, optionally filtered by connection name."""
    return await _call(backup.list_backups, user_anon_id=None, connection_name=connection_name)


@mcp.tool(annotations=_READ)
async def vector_schema(connection_id: str, collection: str) -> dict:
    """Describe the properties/fields of a vector DB collection."""
    return await _call(vector.get_schema, connection_id=connection_id, collection=collection, user_anon_id=None)


@mcp.tool(annotations=_READ)
async def papi_status(connection_id: str, database: str) -> Any:
    """Whether Pilotbase's generated REST API is enabled for a database."""
    return await _call(connections.papi_status, connection_id, database=database, user_anon_id=None)


@mcp.tool(annotations=_READ)
async def papi_list_tables(connection_id: str, database: str) -> Any:
    """Tables in a database and whether each one is exposed through the generated REST API."""
    return await _call(connections.papi_list_tables, connection_id, database=database, user_anon_id=None)


async def _papi_authed(connection_id: str, database: str, session: AsyncSession) -> tuple:
    """The generated API's bearer-token check is for external apps; MCP callers
    are the local admin, so only require the API to be enabled."""
    conn, _secret = await papi._require_enabled(connection_id, database, session)
    return conn, database


async def _papi_call(fn, connection_id: str, database: str, **kwargs) -> Any:
    async with AsyncSessionLocal() as session:
        try:
            authed = await _papi_authed(connection_id, database, session)
            result = await fn(authed=authed, session=session, **kwargs)
        except HTTPException as e:
            raise ToolError(str(e.detail))
    return jsonable_encoder(result)


@mcp.tool(annotations=_READ)
async def papi_list_rows(connection_id: str, database: str, table: str, limit: int = 100, offset: int = 0) -> Any:
    """List rows of a table through the generated REST API (the table must be enabled)."""
    return await _papi_call(papi.list_rows, connection_id, database, table=table, limit=limit, offset=offset)


@mcp.tool(annotations=_READ)
async def papi_get_row(connection_id: str, database: str, table: str, guid: str) -> Any:
    """Fetch one row by its generated-API guid."""
    return await _papi_call(papi.get_row, connection_id, database, table=table, guid=guid)


# ── Write tools (MCP_ALLOW_WRITES=true only) ──────────────────────────────────

if settings.mcp_allow_writes:

    @mcp.tool(annotations=_WRITE)
    async def create_connection(
        name: str, db_type: str, host: Optional[str] = None, port: Optional[int] = None,
        database: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None,
        ssl_mode: Optional[str] = None, extra_params: Optional[str] = None,
    ) -> Any:
        """Save a new database connection in Pilotbase."""
        return await _call(
            connections.create_connection,
            _body=lambda uid: connections.ConnectionCreate(
                user_anon_id=uid, name=name, db_type=db_type, host=host, port=port, database=database,
                username=username, password=password, ssl_mode=ssl_mode, extra_params=extra_params,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def update_connection(
        connection_id: str, name: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None,
        database: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None,
        ssl_mode: Optional[str] = None, extra_params: Optional[str] = None,
    ) -> Any:
        """Update fields of a saved connection (omitted fields are left unchanged)."""
        return await _call(
            connections.update_connection, connection_id,
            _body=lambda uid: connections.ConnectionUpdate(
                user_anon_id=uid, name=name, host=host, port=port, database=database,
                username=username, password=password, ssl_mode=ssl_mode, extra_params=extra_params,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def delete_connection(connection_id: str) -> Any:
        """Remove a saved connection from Pilotbase (does not touch the database itself)."""
        return await _call(connections.delete_connection, connection_id, user_anon_id=None)

    @mcp.tool(annotations=_WRITE)
    async def test_connection_params(
        db_type: str, host: Optional[str] = None, port: Optional[int] = None,
        database: Optional[str] = None, username: Optional[str] = None, password: Optional[str] = None,
        ssl_mode: Optional[str] = None, extra_params: Optional[str] = None,
    ) -> Any:
        """Test connection details before saving them; returns reachable databases on success."""
        return await _call(
            connections.test_connection_params,
            _body=lambda uid: connections.ConnectionTestParams(
                user_anon_id=uid, db_type=db_type, host=host, port=port, database=database,
                username=username, password=password, ssl_mode=ssl_mode, extra_params=extra_params,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def run_ddl(
        connection_id: str,
        action: Literal["truncate", "drop_table", "drop_view", "drop_database", "create_database"],
        object_name: str, object_type: Literal["table", "view", "database"],
        database: Optional[str] = None, schema_name: Optional[str] = None,
    ) -> Any:
        """Truncate/drop a table or view, or create/drop a database. Destructive — confirm with the user first."""
        return await _call(
            query_router.run_ddl,
            _body=lambda uid: query_router.DDLRequest(
                user_anon_id=uid, connection_id=connection_id, action=action, object_name=object_name,
                object_type=object_type, database=database, schema_name=schema_name,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def admin_create_database(connection_id: str, db_name: str) -> Any:
        """Create a new database on the connection's server."""
        return await _call(
            connections.create_database, connection_id,
            _body=lambda uid: connections.CreateDatabaseBody(user_anon_id=uid, db_name=db_name),
        )

    @mcp.tool(annotations=_WRITE)
    async def admin_create_user(
        connection_id: str, username: str, password: str, database: Optional[str] = None,
    ) -> Any:
        """Create a database login/user on the connection's server."""
        return await _call(
            connections.create_db_user, connection_id,
            _body=lambda uid: connections.CreateUserBody(
                user_anon_id=uid, username=username, password=password, database=database,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def migration_execute(
        source_connection_id: str, target_connection_id: str, objects: List[Dict[str, Any]],
        scope: Literal["schema", "schema_data"] = "schema", schema: Optional[str] = None,
    ) -> Any:
        """Start a migration job. `objects` items: {name, status, include, version_instead_of_overwrite}
        as returned by migration_objects. Poll migration_job_status for progress."""
        return await _call(
            migration.migration_execute,
            _body=lambda uid: migration.ExecuteRequest(
                user_anon_id=uid, source_connection_id=source_connection_id,
                target_connection_id=target_connection_id, schema=schema, scope=scope,
                objects=[migration.ObjectExecSpec(**o) for o in objects],
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def run_backup(connection_id: str, database: Optional[str] = None) -> Any:
        """Create a backup file of a database (see list_backups)."""
        return await _call(
            backup.run_backup,
            _body=lambda uid: backup.BackupRequest(user_anon_id=uid, connection_id=connection_id, database=database),
        )

    @mcp.tool(annotations=_WRITE)
    async def vector_update_chunk(connection_id: str, collection: str, chunk_id: str, properties: Dict[str, Any]) -> Any:
        """Update the properties of one vector DB record."""
        return await _call(
            vector.update_chunk,
            _body=lambda uid: vector.ChunkUpdateRequest(
                user_anon_id=uid, connection_id=connection_id, collection=collection,
                chunk_id=chunk_id, properties=properties,
            ),
        )

    @mcp.tool(annotations=_WRITE)
    async def vector_delete_chunk(connection_id: str, collection: str, chunk_id: str) -> Any:
        """Delete one vector DB record."""
        return await _call(
            vector.delete_chunk,
            _body=lambda uid: vector.ChunkDeleteRequest(
                user_anon_id=uid, connection_id=connection_id, collection=collection, chunk_id=chunk_id,
            ),
        )

    def _papi_db_body(database: str):
        return lambda uid: connections.PapiDatabaseRequest(user_anon_id=uid, database=database)

    @mcp.tool(annotations=_WRITE)
    async def papi_enable(connection_id: str, database: str) -> Any:
        """Enable Pilotbase's generated REST API for a database."""
        return await _call(connections.enable_papi, connection_id, _body=_papi_db_body(database))

    @mcp.tool(annotations=_WRITE)
    async def papi_disable(connection_id: str, database: str) -> Any:
        """Disable the generated REST API for a database."""
        return await _call(connections.disable_papi, connection_id, _body=_papi_db_body(database))

    @mcp.tool(annotations=_WRITE)
    async def papi_enable_table(connection_id: str, database: str, table_name: str) -> Any:
        """Expose one table through the generated REST API."""
        return await _call(connections.papi_enable_table, connection_id, table_name, _body=_papi_db_body(database))

    @mcp.tool(annotations=_WRITE)
    async def papi_disable_table(connection_id: str, database: str, table_name: str) -> Any:
        """Stop exposing one table through the generated REST API."""
        return await _call(connections.papi_disable_table, connection_id, table_name, _body=_papi_db_body(database))

    @mcp.tool(annotations=_WRITE)
    async def papi_create_row(connection_id: str, database: str, table: str, row: Dict[str, Any]) -> Any:
        """Insert a row through the generated REST API."""
        return await _papi_call(papi.create_row, connection_id, database, table=table, body=row)

    @mcp.tool(annotations=_WRITE)
    async def papi_update_row(connection_id: str, database: str, table: str, guid: str, row: Dict[str, Any]) -> Any:
        """Update a row (by guid) through the generated REST API."""
        return await _papi_call(papi.update_row, connection_id, database, table=table, guid=guid, body=row)

    @mcp.tool(annotations=_WRITE)
    async def papi_delete_row(connection_id: str, database: str, table: str, guid: str) -> Any:
        """Soft-delete a row (by guid) through the generated REST API."""
        return await _papi_call(papi.delete_row, connection_id, database, table=table, guid=guid)


# `host` drives the SDK's DNS-rebinding guard: localhost-only Host headers when
# bound to 127.0.0.1 (desktop), unrestricted when bound to 0.0.0.0 (Docker).
mcp_http_app = mcp.streamable_http_app(json_response=True, stateless_http=True, host=settings.host)
