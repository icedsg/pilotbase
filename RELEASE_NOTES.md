# Pilotbase Beta 1.2

**Desktop app**

- Pilotbase now ships as a native desktop app for Windows, macOS, and Linux — see [`desktop/README.md`](desktop/README.md) to build and run it.
- No Docker or Postgres required: the desktop build bundles the backend as a local sidecar process and stores data in SQLite under the OS-standard app data directory.
- Backend binds to `127.0.0.1` only, on an OS-assigned port, guarded by a per-launch token — never reachable from the network.
- New **Settings** screen (gear icon, or `Cmd/Ctrl+,`) to configure the AI provider: local Ollama or OpenRouter, with a **Test** button and encrypted API key storage.
- External links open in the OS browser instead of navigating the app window.
- Full technical spec at [`docs/desktop-plan.md`](docs/desktop-plan.md).

---

# Pilotbase Beta 1.1

**DuckDB — full support**

- DuckDB connections now work for both file paths and `:memory:` (the in-memory database is shared across requests for the life of the server; previously `:memory:` failed to open).
- Table inspector, migration diff, backups, and Export as SQL now show DuckDB primary keys, foreign keys, and indexes (read from DuckDB's own catalog — the SQLAlchemy dialect doesn't reflect them).
- Column types are reported as DuckDB writes them (`VARCHAR[]`, `STRUCT(...)`, `DECIMAL(10,2)`) instead of `NULL` for nested types; Export as SQL renders list/struct/map values as DuckDB literals so the script round-trips.
- INSERT/UPDATE/DELETE report affected-row counts; DDL no longer returns an empty `Count` column.
- Rename table is supported; renaming a table that has indexes or is referenced by a foreign key returns a clear message instead of a raw dependency error.
- Migration copy uses `ON CONFLICT DO NOTHING` for DuckDB targets; public API (papi) system columns use native `BOOLEAN`/`TIMESTAMP`.
- Added the DuckDB data-type catalog (`knowledge/duckdb`) so the column type picker offers DuckDB types.
- Connection form shows a DuckDB-specific path hint and the file-lock caveat.

**Bearer-token authentication**

- New optional **Bearer Token** field on the connection form for Qdrant (RBAC JWT), Weaviate (OIDC / Weaviate Cloud access token), CouchDB (JWT), and Snowflake (OAuth access token).
- ChromaDB and Milvus API keys are documented as bearer tokens (that is how they are sent).
- Auth matrix per engine added to `docs/supported-databases.md`.

**Security**

- API keys and bearer tokens stored in a connection's extra parameters are now Fernet-encrypted at rest, the same as passwords. Existing plaintext keys are sealed the next time the connection is edited. Editing a connection and leaving a key blank keeps the stored one.

**Fixes**

- Raw SQL containing a colon inside a literal (DuckDB `{'a':1}` structs, Postgres `'{"a":1}'::jsonb`, `'10:30'` strings) no longer fails with "A value is required for bind parameter"; parameterless queries are passed to the driver untouched.

---

# Pilotbase Beta 1 — First Public Release

The first public release of Pilotbase — an open-source database admin that connects to relational, NoSQL, and vector databases from a single web UI.

---

## What's included

**Database support**

- SQL: PostgreSQL, MySQL/MariaDB, SQLite, Microsoft SQL Server, Oracle, Db2, CockroachDB, Snowflake
- NoSQL: MongoDB (queries + aggregation), Redis (native commands), Cassandra (CQL), DynamoDB (scan/get-item)
- Vector: Qdrant, ChromaDB, Weaviate, Pinecone, Milvus — browse chunks, run similarity search, edit payloads

**Query & Browse**

- Monaco-based SQL editor with Ctrl+Enter to run
- Resizable split pane: editor + results table
- Schema tree — databases, schemas, tables, views, collections, keys
- Table inspector: column types, primary keys, foreign keys, indexes
- NoSQL document viewer with JSON rendering
- Vector chunk browser with similarity search and inline payload editing

**AI Agent**

- LangGraph ReAct agent connected to your active database
- Ask questions in plain English — the agent queries and explains
- Works with any local Ollama model or OpenAI-compatible API endpoint
- Warns before any write or destructive operation

**Connection management**

- Encrypted credential storage (Fernet)
- Test before save with inline error messages
- Per-connection read/write/admin permissions
- Token-based invite links for multi-user setups

---

## In development

- Schema migration: diff two databases, preview and apply changes
- Scheduled and on-demand database backups
- Query history and saved queries

---

## Getting started

```bash
git clone https://github.com/icedsg/pilotbase.git
cd pilotbase
docker compose up --build
```

That's it. Pilotbase will be running in Docker and accessible at **http://localhost:8000**.

**Option 1 — Pre-configure connections at startup**

Edit `api/defaultConnections.py` before running. Connections defined here are created automatically on first run, appear for all users, and cannot be deleted from the UI.

```python
DEFAULT_CONNECTIONS = [
    {
        "name": "Production PostgreSQL",
        "db_type": "postgresql",
        "host": "db.example.com",
        "port": 5432,
        "database": "mydb",
        "username": "admin",
        "password": "secret",
    },
    {
        "name": "Dev Redis",
        "db_type": "redis",
        "host": "localhost",
        "port": 6379,
    },
]
```

Supported `db_type` values: `postgresql`, `mysql`, `mariadb`, `sqlite`, `duckdb`, `mssql`, `oracle`, `db2`, `cockroachdb`, `snowflake`, `mongodb`, `redis`, `cassandra`, `couchdb`, `dynamodb`, `qdrant`, `chroma`, `weaviate`, `pinecone`, `milvus`.

**Option 2 — Add connections from the browser**

Click "Add Connection" in the sidebar and fill in the details. These connections are saved to your browser session via a cookie. If you clear your browser cookies or open Pilotbase in a different browser, the connections will not carry over.

---

## Notes

This is a beta release. Core features are stable but APIs and configuration may change before 1.0. Report bugs and feedback via [GitHub Issues](https://github.com/icedsg/pilotbase/issues).
