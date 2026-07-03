# jul26-plan.md

> On approval, save this document verbatim as `jul26-plan.md` in the repo root (`i:\projects\pilotbase\jul26-plan.md`) as the first implementation step, then execute the prompts below in order.

## Context

Pilotbase already has partial backend scaffolding for backups (`backup_service.py`, `routers/backup.py`) and schema migration diffing (`migration_service.py`, `routers/migration.py`), but neither is wired into the UI, and both have real gaps (blocking I/O, missing engines, shallow diffing). The AI agent (`db_agent.py`, LangGraph ReAct loop) currently free-executes any non-blocklisted SQL with no user confirmation, and its destructive-action blocklist has coverage gaps (GRANT/REVOKE/ALTER USER aren't blocked). This plan closes all of that, and adds a fourth, net-new capability: a generated Firebase-style CRUD API over a connection's tables/collections, authenticated by self-service JWT session tokens, so a mobile/app developer can build on top of a Pilotbase-managed database without going through Pilotbase's own UI auth.

Four independent workstreams, each written below as a sequence of concrete implementation prompts referencing exact files and reused utilities found during research. Build in this order: **3c (shared destructive validator) → 1 (Backup) → 2 (Plan Migration) → 4 (Generated CRUD API) → 3a/b/d (Agent plan/approve/commit)**. Only 3c → 3b is a hard dependency; 1, 2, and 4 are mutually independent and can be built in parallel if desired.

---

## Feature 3c — Shared destructive-action validator (build first)

**Prompt 1:** In `api/app/services/db_service.py`, inside `DatabaseService.execute_query` (~L808), add a shared validator function `_check_agent_forbidden(sql: str) -> str | None` near the top of the file. It must split the incoming SQL into individual statements (reuse the existing `sqlparse`-based splitting already used for multi-statement support in this method) and check **each** statement against a regex covering: `DROP`, `DELETE`, `TRUNCATE`, `GRANT`, `REVOKE`, `CREATE\s+(USER|ROLE)`, `DROP\s+(USER|ROLE)`, `ALTER\s+(USER|ROLE)`, `SET\s+ROLE` (case-insensitive, matched at the start of each individual statement after splitting — not a single multiline regex over the whole raw string, so `SELECT 1; DELETE FROM x` cannot slip through by being on one line). In `execute_query`, when the caller passed `source="agent"`, run this check before executing any statement; if it matches, raise an exception (or return an error result consistent with this method's existing error-handling convention) with a message like `"BLOCKED: <op> is not permitted through the AI agent."` Do not change behavior when `source="user"` — the existing UI `/query/ddl` whitelisted-action flow in `routers/query.py` is untouched.

**Prompt 2:** In `api/app/agents/tools/query_tools.py`, remove the local `_DESTRUCTIVE` regex and its check in `run_sql_query` (~L6, L17-18) since enforcement now lives in `db_service.execute_query`. Keep a lightweight try/except around the `db_service.execute_query` call so the blocked-error message is still returned as a normal tool-result string to the LLM (not an unhandled exception).

**Prompt 3:** In `api/app/agents/tools/admin_tools.py`, remove `create_db_user` from the list of tools returned to the agent (it issues `GRANT ALL PRIVILEGES`, a permission change). Keep the underlying `db_service.create_db_user` method intact for any existing UI/admin-only call path — only the agent's tool list changes.

---

## Feature 1 — DB Backup → browser download

**Prompt 1 (backend, async offload + hardening):** In `api/app/routers/backup.py`, change `POST /run` to call `backup_service.run_backup` via `run_in_executor` (loop.run_in_executor(None, backup_service.run_backup, conn)) instead of calling it directly in the async def, so a large `pg_dump`/`mysqldump` subprocess never blocks the event loop. In `download_backup`, add a path-traversal guard: reject `filename` values containing `/`, `\`, or `..` before joining with `settings.backups_dir`, returning a 400.

**Prompt 2 (backend, access control):** In `api/app/routers/backup.py`, add `user_anon_id` handling consistent with `api/app/routers/connections.py`'s `_require_admin`/`ConnectionAccess` pattern (~L134-151) to all three endpoints (`/run`, `/list`, `/download/{filename}`), requiring at least `can_read` access on the target connection before allowing backup/list/download.

**Prompt 3 (backend, Mongo support):** In `api/app/services/backup_service.py`, add `_mongo_dump(conn)` alongside `_pg_dump`/`_mysql_dump`/`_generic_dump`, dumping each collection to JSONL using the existing Mongo adapter/client from `db_service`. Wire it into `run_backup`'s dispatch by `db_type`. For Redis/Qdrant/Chroma/Weaviate, have `run_backup` return a clear `"Backup not supported for {db_type}"` result rather than letting `get_engine()` raise an opaque error. Also fix the `_mysql_dump` bug where the output file is opened before checking the `mysqldump` binary exists (use `shutil.which("mysqldump")` first so a missing binary doesn't leave a zero-byte file before falling back to `_generic_dump`).

**Prompt 4 (frontend, API client):** In `ui/src/api/client.ts`, add `apiDownloadBackup(userId: string, filename: string)` using axios with `responseType: 'blob'`, following the existing typed-wrapper convention in this file (see `apiRunBackup`/`apiListBackups` ~L97-103). Use the `downloadCsv` blob-download pattern already in `ui/src/components/db/ResultsTable.tsx` (~L29-45: `URL.createObjectURL`, temp `<a download>`, click, `URL.revokeObjectURL`) to trigger the browser download once the blob is retrieved.

**Prompt 5 (frontend, modal):** Create `ui/src/components/backup/BackupModal.tsx` following the full-modal chrome used in `ui/src/components/db/QueryHistoryPanel.tsx` (`fixed inset-0 z-[10000]` backdrop, `bg-surface-100 border border-surface-50 rounded-xl shadow-2xl` card, header with title + close `X`, Escape-to-close via `useEffect` keydown listener). Body: a "Run backup" button (calls `apiRunBackup`, then refreshes the list) above a list of existing backups from `apiListBackups` (filename, size, created_at per row), each row with a "Download" button wired to `apiDownloadBackup`.

**Prompt 6 (frontend, entry points):** Wire `ui/src/components/layout/TopBar.tsx`'s existing "Backups" nav button (~L31-40, currently has no `onClick`) to open `BackupModal` for the active connection. Also add a "Run Backup" item to the database-level context menu in `ui/src/components/db/ConnectionTree.tsx` (`dbCtxMenu`, rendered ~L553-579), between "Refresh" and "Drop Database", that opens the same modal scoped to that connection.

---

## Feature 2 — "Plan Migration" (right-click DB → compare against another connection)

**Prompt 1 (backend, diff enrichment):** In `api/app/services/migration_service.py`, extend `diff()` (~L32-63) to also report, per side:
- Views: via `inspector.get_view_names(schema=...)`, diffed added/dropped.
- Stored procedures/functions: add a `_list_routines(engine, dialect)` helper — Postgres/MySQL via `information_schema.routines`, MSSQL via `sys.procedures`, SQLite returns empty (no routines). Diff added/dropped by name.
- Row counts: add `_table_stats(engine, dialect)` — use cheap estimates where available (Postgres `pg_stat_user_tables.n_live_tup`, MySQL `information_schema.tables.table_rows`), falling back to `SELECT COUNT(*)` for SQLite/other dialects.
- Data size: Postgres `pg_total_relation_size(relid)`, MySQL `information_schema.tables.(data_length+index_length)`; omit for dialects without a cheap equivalent.
- Indexes and foreign keys: the snapshot already collects these (per earlier research) but never diffs them — add added/dropped/changed diffing for both, using `inspector.get_indexes`/`get_foreign_keys`.

Branch the whole `diff()`/`_get_schema_snapshot` flow on adapter type (mirroring the `isinstance(adapter, SQLAdapter)` pattern already used in `db_service.py`) instead of unconditionally calling `get_engine()`. For MongoDB connections, list collections with `collStats`/`dbStats` for doc counts and size, and treat collections as the "tables" side of the diff. If one side is SQL and the other is Mongo, return a clear error rather than attempting a mixed comparison.

Return shape becomes: `{ added_tables, dropped_tables, column_changes, added_views, dropped_views, added_routines, dropped_routines, table_stats: {name: {src_rows, tgt_rows, src_size, tgt_size}}, index_changes, fk_changes }`.

**Prompt 2 (backend, access control):** In `api/app/routers/migration.py`, add the same `ConnectionAccess`/`_require_admin`-style check used in `connections.py` to `POST /diff` and `POST /script`, requiring `can_read` on both the source and target connection.

**Prompt 3 (frontend, types + store):** In `ui/src/types/index.ts`, add a `MigrationDiff` type matching the enriched backend return shape above. In `ui/src/store/index.ts`, add a `migrationViewContext: MigrationViewContext | null` slice (mirroring the existing `vectorViewContext`/`nosqlViewContext` pattern ~L59-71), where `MigrationViewContext = { sourceConnId: string; sourceDb: string | null; targetConnId: string; targetDb: string | null }`, plus a `setMigrationViewContext` setter.

**Prompt 4 (frontend, context menu entry):** In `ui/src/components/db/ConnectionTree.tsx`, add a "Plan Migration" item to the existing database-level context menu (`dbCtxMenu`, rendered ~L553-579), between "Refresh" and "Drop Database". Clicking it opens a new target-picker modal (next prompt), scoped to that database as the source.

**Prompt 5 (frontend, target picker modal):** Create `ui/src/components/migration/MigrationTargetPicker.tsx`, reusing the modal chrome from `QueryHistoryPanel.tsx`/`AdminActionsPanel.tsx` (the latter's internal tab-switcher, `AdminActionsPanel.tsx`, is a good precedent for a stepper: pick connection → pick database). List the store's `connections` array (excluding the source connection), let the user pick a target connection and target database, then call `apiSchemaDiff`, set `migrationViewContext` with both sides, and close the picker.

**Prompt 6 (frontend, compare view):** Create `ui/src/components/migration/MigrationCompareView.tsx`. Render it as a full-area "special view" the same way `VectorChunksView`/`NoSQLDocumentView` are rendered in `ui/src/components/layout/MainArea.tsx` (fold `migrationViewContext` into the existing `isSpecialView` check ~L20, add the render branch ~L95-109). Show tables/views/stored-procs/collections with row counts and data sizes on both sides, using the plain-HTML-table Tailwind conventions from `ResultsTable.tsx` (sticky `<thead>`, `min-w-full text-xs font-mono`), without the drag-sort behavior. Include a "Generate migration script" button that calls `apiMigrationScript` and displays the resulting SQL.

**Prompt 7 (frontend, logo returns to normal view):** In `ui/src/components/common/Logo.tsx` (the `LogoIcon` used in `TopBar.tsx` ~L29 and `MainArea.tsx` ~L26,41), add an `onClick` handler that clears every special view context (`setVectorViewContext(null)`, `setNosqlViewContext(null)`, `setMigrationViewContext(null)`), returning the main area to the normal query editor view.

---

## Feature 4 — Generated CRUD API ("papi") per database, JWT session auth

Whole-database switch (not per-table). Supports SQL and MongoDB connections. No FK/data validation — a thin passthrough CRUD layer. Auth is self-service: anyone can call `create_token` to mint a JWT session (rate-limited), and every other call on the generated API validates that JWT plus a revocation check against a per-database `apitokens` table (the "get" half of the auth flow).

**Prompt 1 (backend, config model):** In `api/app/models/`, add `papi_config.py` with a `PapiConfig` model (Pilotbase's own internal metadata DB, via `app.database.Base` — not the user's target database): `connection_id` (PK, FK to `db_connections.id`), `enabled: bool`, `jwt_secret_encrypted: str` (Fernet-encrypted, reuse the existing encryption helper pattern from `db_service.py`'s `encrypt_password`/`decrypt_password`), `enabled_at: datetime`. Import it in `app/database.py`'s `init_db()` alongside the other model imports so its table gets created.

**Prompt 2 (backend, enable/disable service):** Create `api/app/services/papi_service.py` with:
- `enable_for_connection(conn)`: generates a JWT secret (`secrets.token_urlsafe(48)`), encrypts and stores it in a new/updated `PapiConfig` row with `enabled=True`. For SQL connections, iterate all tables via `db_service.list_objects`/inspector and run dialect-specific `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (or the dialect's equivalent guard) to add: `guid` (UUID/TEXT primary-key-free identifier column, default-generated per dialect — e.g. Postgres `gen_random_uuid()`, else generate in application code), `created_at` (timestamp, default now), `last_updated` (timestamp, nullable), `is_deleted` (boolean, default false) — reuse the dialect-branching style already established in `migration_service.generate_migration_sql`. Also create an `apitokens` table (SQL) or collection (Mongo) if missing, with columns/fields: `id` (the JWT's `jti`, primary key), `created_at`, `expires_at`, `revoked` (bool, default false), `ip`, `user_agent`. For MongoDB connections, no ALTER is needed (schemaless) — just ensure the `apitokens` collection exists; injected fields (`guid`/`created_at`/`last_updated`/`is_deleted`) are added at write time per document instead.
- `disable_for_connection(conn)`: sets `enabled=False` on `PapiConfig` (does not drop columns/data).
- `create_token(conn, ip, user_agent) -> str`: generates a `jti` (uuid4), inserts a row/document into `apitokens` via the connection's adapter, signs a JWT with claims `{jti, conn_id, iat, exp}` using the connection's decrypted `jwt_secret` and `python-jose` (already a dependency, `api/requirements.txt` L33), returns the encoded JWT string.
- `validate_token(conn, token) -> bool`: decodes/verifies the JWT signature and expiry with `python-jose`, then looks up the `jti` in the `apitokens` table/collection to confirm `revoked=False` (the "get" lookup), returns True/False.

**Prompt 3 (backend, rate limiting):** Create `api/app/papi_ratelimit.py` with a small in-memory sliding-window limiter keyed by `hash(ip + user_agent)` (e.g. a dict of deques of timestamps, no external dependency needed since none is present in `requirements.txt`). Expose two FastAPI dependencies: `rate_limit_create_token` (1 request/sec per key) and `rate_limit_validate` (20 requests/sec per key), each raising HTTP 429 when exceeded. Note in a code comment that this is process-local (fine for a single-instance deployment; would need a shared store like Redis for multi-instance).

**Prompt 4 (backend, CRUD passthrough):** In `papi_service.py`, add generic passthrough operations used by the router (all reusing `db_service`'s adapters, not bypassing them):
- `list_rows(conn, table, limit, offset)`: `SELECT * FROM {table} WHERE is_deleted = false LIMIT/OFFSET` for SQL, `find({is_deleted: false})` for Mongo.
- `get_row(conn, table, guid)`.
- `create_row(conn, table, body: dict)`: server sets `guid` (generate if absent), `created_at`, `last_updated`, `is_deleted=false`, then inserts the remaining body fields as-is (no FK/type validation — pass through directly to the adapter's parameterized insert).
- `update_row(conn, table, guid, body: dict)`: updates provided fields plus `last_updated=now()`.
- `soft_delete_row(conn, table, guid)`: sets `is_deleted=true` (no hard delete exposed).

**Prompt 5 (backend, router):** Create `api/app/routers/papi.py`, mounted in `api/main.py` at prefix `/api/v1/papi` (tag `"public-api"`), alongside the other `app.include_router(...)` calls (~L51-58). Endpoints:
- `POST /{conn_id}/apitokens` (public, no Pilotbase session auth, gated by `rate_limit_create_token`): calls `papi_service.create_token`, returns `{"token": "<jwt>"}`.
- `GET /{conn_id}/apitokens/validate` (public, gated by `rate_limit_validate`, reads `Authorization: Bearer <token>`): calls `papi_service.validate_token`, returns `{"valid": true/false}`.
- A shared FastAPI dependency `require_papi_token(conn_id, authorization header)` used by all CRUD routes below: looks up `PapiConfig` for `conn_id`, confirms `enabled=True`, then calls `papi_service.validate_token`; raises 401 if missing/invalid/revoked/disabled.
- `GET /{conn_id}/{table}`, `GET /{conn_id}/{table}/{guid}`, `POST /{conn_id}/{table}`, `PUT /{conn_id}/{table}/{guid}`, `DELETE /{conn_id}/{table}/{guid}` — all behind `require_papi_token`, calling the passthrough operations from Prompt 4.

**Prompt 6 (backend, enable/disable exposed to Pilotbase UI):** In `api/app/routers/connections.py`, add `POST /{conn_id}/papi/enable` and `POST /{conn_id}/papi/disable`, gated by the existing `_require_admin` helper (~L134-151), calling `papi_service.enable_for_connection`/`disable_for_connection`. Return the current `PapiConfig` status (enabled flag, enabled_at) — never return the raw JWT secret.

**Prompt 7 (frontend, types + client):** In `ui/src/types/index.ts`, add a `PapiConfig` type (`{ connectionId, enabled, enabledAt }`). In `ui/src/api/client.ts`, add `apiEnablePapi(userId, connId)`, `apiDisablePapi(userId, connId)`, following the existing typed-wrapper convention.

**Prompt 8 (frontend, config panel):** Create `ui/src/components/papi/ApiConfigModal.tsx`, reusing the modal chrome from `QueryHistoryPanel.tsx`. Show an enable/disable toggle for the connection's generated API, and once enabled, display the base URL for the generated endpoints (`{VITE_API_URL}/api/v1/papi/{conn_id}`) plus a short usage note (`POST .../apitokens` to get a session token, then `Authorization: Bearer <token>` on every other call) so the developer can wire up their own app. Add an "Enable API" item to the database-level context menu in `ConnectionTree.tsx` (`dbCtxMenu`, same location as the Backup/Migration menu items added above) that opens this modal.

---

## Feature 3a/b/d — Agent plan / approve / commit gate

Builds on the shared validator from Feature 3c (already done first). Mechanism: **two-phase intercept at the tool layer** — no LangGraph checkpointer/`interrupt()` (the agent is rebuilt fresh per HTTP request with no persistence today, and `langgraph>=0.2.28` is at the edge of mature HITL support, so adding a checkpointer + threaded `thread_id` would be a large, fragile change). Instead, mutating tools run in a "propose only" mode that records intended actions into a plan instead of executing; the plan is shown to the user in the chat panel with Approve/Reject; only Approve triggers real execution, replayed through the same validated `db_service.execute_query` path.

**Prompt 1 (backend, propose-mode tools):** In `api/app/agents/tools/query_tools.py`, add a `propose_only: bool` flag and a shared `plan_sink: list` parameter to the tool factory. When `propose_only=True`, `run_sql_query` validates the SQL (still via `db_service`'s shared validator — call it directly or via a dry-run path that doesn't execute), appends `{"tool": "run_sql_query", "sql": sql}` to `plan_sink`, and returns `"PLANNED: <sql>"` to the LLM without executing. Read-only tools (`list_tables`, `describe_table`, `list_databases`) are unaffected and always execute immediately so the agent can inspect state before proposing. In `api/app/agents/tools/admin_tools.py`, route `create_database` through the same propose/plan mechanism.

**Prompt 2 (backend, agent wiring):** In `api/app/agents/db_agent.py`, thread `propose_only` and `plan_sink` parameters through `create_db_agent(...)` into the tool factories. Update `SYSTEM_PROMPT` (~L32-48) to instruct the model to inspect the database (read-only tools) and then propose a plan rather than assuming it can execute directly, and to state plainly that destructive/permission-changing operations are not available to it at all.

**Prompt 3 (backend, plan lifecycle endpoints):** In `api/app/routers/ai.py`, in the WS chat handler (`run_agent` inside `POST /chat/ws`, ~L103-136), run the agent with a fresh `plan_sink = []` each turn. After `agent.invoke` completes: if `plan_sink` is non-empty, generate a `plan_id` (uuid4), store `{conn, plan_sink, user_id}` in a module-level `pending_plans: dict` (bounded size, simple TTL eviction), and send a new WS message via `manager.send(user_id, "plan_proposed", {"plan_id": plan_id, "steps": plan_sink})` instead of `"agent_done"`. If `plan_sink` is empty (pure Q&A / read-only turn), send `"agent_done"` as today. Add two new endpoints: `POST /ai/plan/commit` (`{user_anon_id, plan_id}`) — looks up the pending plan, re-validates each step's SQL against the shared destructive-action validator (defense in depth), replays each step via `db_service.execute_query(conn, sql, user_id=user_id, source="agent")`, removes the plan from `pending_plans`, and sends `manager.send(user_id, "plan_committed", {"plan_id": plan_id, "results": [...]})`. `POST /ai/plan/reject` (`{user_anon_id, plan_id}`) — discards the pending plan and sends `manager.send(user_id, "plan_rejected", {"plan_id": plan_id})`.

**Prompt 4 (frontend, WS + store):** In `ui/src/hooks/useWebSocket.ts`, handle the three new message types: `plan_proposed` (store into a new `pendingPlan` store slice), `plan_committed` (append an assistant-style message summarizing the results, clear `pendingPlan`), `plan_rejected` (clear `pendingPlan`). In `ui/src/store/index.ts`, add `pendingPlan: { planId: string; steps: any[] } | null` and its setter, next to the existing `chatMessages`/`chatLoading` state.

**Prompt 5 (frontend, API client + UI):** In `ui/src/api/client.ts`, add `apiCommitPlan(userId, planId)` → `POST /ai/plan/commit` and `apiRejectPlan(userId, planId)` → `POST /ai/plan/reject`. In `ui/src/components/layout/RightPanel.tsx`, when `pendingPlan` is set, render a plan card listing each proposed step (tool name + SQL/args) styled consistently with the existing chat bubbles, with "Approve" (calls `apiCommitPlan`, then clears `pendingPlan` once `plan_committed` arrives) and "Reject" (calls `apiRejectPlan`) buttons.

**Prompt 6 (frontend, cleanup):** In `ui/src/components/layout/RightPanel.tsx`, fix the pre-existing error-message copy that references `ANTHROPIC_API_KEY` (the backend actually uses `ChatOpenAI` against an Ollama-compatible endpoint per `settings.ollama_base_url`/`ollama_model`) — change it to a generic "AI agent unavailable, check server configuration" message.

---

## Verification

**Feature 3c:** Send agent prompts containing `DELETE`, `DROP TABLE`, `TRUNCATE`, `GRANT`, `CREATE USER`, `ALTER ROLE`, and a single-line `SELECT 1; DELETE FROM x` — confirm all are blocked via `db_service.execute_query` when `source="agent"`, and that the same statements still succeed through the UI's `/query/ddl`/`/query/execute` path (`source="user"`).

**Feature 1:** Run a backup for a Postgres connection with and without `pg_dump` on PATH (confirm fallback to generic dump), for MySQL, SQLite, and Mongo; confirm an unsupported type (e.g. Redis) returns a clean error. Confirm `POST /run` no longer blocks other requests during a large dump. From the UI, trigger a backup from both the TopBar button and the DB context menu, then download and confirm the file is non-empty with the correct filename.

**Feature 2:** Diff two Postgres databases that differ in a table, a column, a view, a stored procedure, an index, and row counts — confirm each shows up in the response. Diff two Mongo connections with different collections. Attempt a SQL-vs-Mongo diff and confirm a clear error. From the UI: right-click a database → Plan Migration → pick a target → confirm `MigrationCompareView` renders both sides with counts/sizes; click the logo and confirm it returns to the normal query view; generate a migration script and confirm valid SQL is produced.

**Feature 4:** Enable the API on a test Postgres database and a test Mongo database; confirm all existing tables gained `guid`/`created_at`/`last_updated`/`is_deleted` and an `apitokens` table/collection was created. Call `POST /{conn_id}/apitokens` and confirm a JWT is returned; call it 2x within a second and confirm the second is rate-limited (429). Use the returned JWT to `POST`/`GET`/`PUT`/`DELETE` rows on an enabled table and confirm CRUD works with no FK/validation errors even for malformed foreign keys. Confirm a `DELETE` sets `is_deleted=true` rather than removing the row. Revoke/expire a token and confirm subsequent calls 401. Disable the API and confirm generated endpoints stop working while existing data is untouched.

**Feature 3a/b/d:** Prompt the agent with an `INSERT`/`CREATE TABLE` request — confirm a `plan_proposed` message arrives and no data is written yet; click Approve and confirm `plan_committed` arrives with the write applied; on a fresh prompt, click Reject and confirm nothing was written. Confirm a pure read-only question (e.g. "what tables exist?") still returns `agent_done` directly with no approval step. Confirm `create_db_user` is no longer available to the agent.

## Critical files
- `api/app/services/db_service.py` — shared destructive-action validator, adapter layer reused by all four features
- `api/app/services/migration_service.py` — diff enrichment
- `api/app/services/backup_service.py` — Mongo dump, binary-check fix
- `api/app/services/papi_service.py` (new) — generated CRUD + JWT auth logic
- `api/app/routers/papi.py` (new), `api/app/routers/ai.py`, `api/app/routers/backup.py`, `api/app/routers/migration.py`
- `api/app/models/papi_config.py` (new)
- `ui/src/store/index.ts` — `migrationViewContext`, `pendingPlan` slices
- `ui/src/components/layout/MainArea.tsx` — special-view swap, logo reset
- `ui/src/components/db/ConnectionTree.tsx` — database context menu entries for Backup/Migration/Enable API
