# Pilotbase

**The first open-source database admin that unifies relational, NoSQL, and vector databases in one interface.**

Stop juggling pgAdmin, MongoDB Compass, RedisInsight, and separate vector DB dashboards. Pilotbase connects to your entire data stack — PostgreSQL, MySQL, SQLite, SQL Server, Oracle, Db2, CockroachDB, Snowflake, MongoDB, Redis, Cassandra, DynamoDB, Qdrant, ChromaDB, Weaviate, Pinecone, Milvus — and lets you query, browse, and manage everything from a single, modern web UI with an AI agent built in.

> **First Beta Release** — Core query, schema browsing, and connection management are stable and production-ready. AI-assisted natural-language querying is live. Schema migration and automated backup features are actively in development and coming soon.

---

## Why Pilotbase?

- **One tool for every database type** — SQL, document, key-value, and vector, with a consistent interface across all of them
- **AI agent that understands your data** — ask questions in plain English, get query results, schema explanations, and insights powered by a local or hosted LLM
- **Zero lock-in** — fully open source (MIT), self-hosted, runs in Docker in minutes
- **Built for AI-era data stacks** — first-class support for vector databases and chunk-level browsing, built for teams that run RAG pipelines alongside traditional databases

---

## Features

### Universal Database Connectivity
- **Relational (SQL)** — PostgreSQL, MySQL, MariaDB, SQLite, Microsoft SQL Server, Oracle, Db2, CockroachDB, Snowflake
- **NoSQL** — MongoDB (find queries + aggregation pipelines), Redis (native command interface), Cassandra (CQL), DynamoDB (scan/get-item)
- **Vector** — Qdrant, ChromaDB, Weaviate, Pinecone, Milvus — browse embeddings, run similarity search, view and edit payloads

### Query & Browse
- Monaco-based editor with SQL syntax highlighting and `Ctrl+Enter` to run
- Resizable split pane — editor on top, results table below
- Schema tree — browse databases, schemas, tables, views, collections, and keys
- Table/collection inspector — column types, primary keys, foreign keys, indexes
- NoSQL document viewer with rich JSON rendering
- Vector chunk browser with similarity search, pagination, and inline payload editing

### AI Agent (LangGraph + ReAct)
- Conversational assistant connected to your active database
- Understands your schema automatically — no manual context needed
- Ask: *"Show me the top 10 customers by revenue this month"* — it writes and runs the query
- Agent warns before any write or destructive operation and asks for confirmation
- Pluggable LLM — defaults to local Ollama, works with any OpenAI-compatible API

### Security & Multi-User
- Encrypted credential storage (Fernet symmetric encryption) for all saved connections
- Token-based invite links for adding users
- Pluggable `AuthBackend` interface — drop in JWT, OAuth2, LDAP, or SSO
- Per-connection read/write/admin permission grants

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, Monaco Editor, Zustand |
| Backend | FastAPI (Python 3.13), SQLAlchemy 2, Alembic |
| AI | LangGraph ReAct agent, LangChain, OpenAI-compatible LLM |
| Real-time | WebSockets for live query streaming |
| Auth | Pluggable `AuthBackend` interface (anonymous mode included) |
| Packaging | Docker multi-stage build (Node 20 → Python 3.13), Docker Compose |

---

## Quick Start (Docker — recommended)

**Requirements:** Docker 24+ and Docker Compose v2+.

```bash
git clone https://github.com/your-org/pilotbase.git
cd pilotbase
```

Edit `api/.env` (copy from `api/.env.example`) and set at minimum:

```env
SECRET_KEY=<generate with: openssl rand -hex 32>
ENCRYPTION_KEY=<generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())">
```

> **Important:** `ENCRYPTION_KEY` must be a valid Fernet key set **before** you create any database connections, and it must never change afterward. Every stored connection password is encrypted with this key — if you change it later, Pilotbase can no longer decrypt existing passwords, and you'll need to re-enter credentials for every affected connection. Generate it once and keep it stable (e.g. in a secrets manager or a `.env` file that persists across deploys).

Then start:

```bash
docker compose up --build
```

Pilotbase will be live at **[http://localhost:8000](http://localhost:8000)**.

The first run builds the React frontend and installs all dependencies inside the image — expect 2–3 minutes. Subsequent starts are instant.

---

## Local Development Setup

**Requirements:** Python 3.13+, Node.js 20+, PostgreSQL 14+ (for Pilotbase's internal metadata store).

### Backend

```bash
cd api
python3.13 -m venv venv

# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # edit .env with your settings
alembic upgrade head   # run migrations
python main.py         # starts on http://localhost:8000
```

Before your first run, set `ENCRYPTION_KEY` in `.env` to a real Fernet key (generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`) — the default value in `config.py` is only a placeholder and is not safe to use as-is. Once you've saved connections with a given key, don't change it (see the note in the Docker section above for why).

### Frontend (with hot reload)

In a separate terminal:

```bash
cd ui
npm install
npm run dev   # starts on http://localhost:5173
```

The Vite dev server proxies `/api` to the backend automatically.

---

## Setting Up Ollama (for the AI Agent)

Pilotbase's AI agent talks to any OpenAI-compatible LLM endpoint, and defaults to Ollama. To run models locally instead of using Ollama's hosted cloud:

1. Install Ollama from [ollama.com/download](https://ollama.com/download)
2. Pull a model: `ollama pull gemma4:31b-cloud` (or any model you prefer)
3. Confirm it's running: `ollama list`
4. In `api/.env`, set:
   ```env
   OLLAMA_BASE_URL=http://localhost:11434/v1
   OLLAMA_MODEL=<your model name>
   OLLAMA_API_KEY=ollama
   ```
5. Restart the backend (or `docker compose up --build` again if running in Docker)

No local GPU or Ollama install? Leave `OLLAMA_BASE_URL` at its default and the agent will use Ollama's hosted cloud models instead — just set a valid `OLLAMA_API_KEY`.

---

## Configuration Reference

All settings are read from environment variables or `api/.env`.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase` | Pilotbase's own internal store |
| `SECRET_KEY` | `change-me` | JWT signing secret — **always override in production** |
| `ENCRYPTION_KEY` | `change-me-must-be-valid-fernet-key=` | Fernet key for stored DB credentials — **always override in production** |
| `OLLAMA_BASE_URL` | `https://ollama.com/v1` | OpenAI-compatible LLM base URL (use `http://localhost:11434/v1` for local Ollama) |
| `OLLAMA_MODEL` | `gemma4:31b-cloud` | Primary reasoning model for the AI agent |
| `OLLAMA_FLASH_MODEL` | `gemma4:cloud` | Faster model for lightweight agent steps |
| `OLLAMA_API_KEY` | `ollama` | API key (`ollama` for local, real key for hosted providers) |
| `AUTH_BACKEND` | `anon` | `anon` for single-user/anonymous, or dotted path to a custom `AuthBackend` class |
| `ENVIRONMENT` | `development` | Set to `production` for tighter CORS and security defaults |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |

**Using a local Ollama instance instead of the cloud:** see [Setting Up Ollama](#setting-up-ollama-for-the-ai-agent) above.

**Using a different hosted LLM:**

Set `OLLAMA_BASE_URL` to any OpenAI-compatible endpoint and provide the appropriate `OLLAMA_API_KEY`. Works with OpenAI, Groq, Together AI, Anthropic (via proxy), and others.

---

## Supported Databases

*Feature support current as of `v0.1.0-beta.2`.*

| Database | Type | Create/Drop DB | Create Tables | Create Views | Querying | Migration | AI Agent Query | Backups | Notes |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| PostgreSQL | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Multi-database, schema browsing, user/DB creation |
| MySQL / MariaDB | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full database listing, user management |
| SQLite | SQL | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Provide the file path as the database field |
| Microsoft SQL Server | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Uses `pymssql` (FreeTDS) — no proprietary ODBC driver needed |
| Oracle Database | SQL | ❌⁴ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | `oracledb` thin mode — no Instant Client install required |
| Db2 (LUW) | SQL | ❌⁴ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Query/browse parity; no SQL-level database/user creation |
| CockroachDB | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Postgres wire-compatible, dedicated retry-aware dialect |
| Snowflake | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Connects via account identifier + optional warehouse/role |
| MongoDB | NoSQL | ❌ | ❌ | ❌ | ✅³ | ❌ | ✅³ | ❌ | JSON find queries and aggregation pipelines |
| Redis | Key-Value | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Native Redis command interface (KEYS, GET, HGETALL, etc.) |
| Cassandra | NoSQL | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Raw CQL queries, keyspace/table browsing |
| DynamoDB | NoSQL | ❌ | ❌ | ❌ | ✅³ | ❌ | ✅³ | ❌ | Scan/get-item queries; AWS creds or DynamoDB Local endpoint |
| Qdrant | Vector | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ANN similarity search, scroll-based browsing, payload editing |
| ChromaDB | Vector | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Text and embedding queries, document browsing |
| Weaviate | Vector | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | GraphQL queries and scroll browsing |
| Pinecone | Vector | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Similarity search and vector browsing by index |
| Milvus | Vector | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ANN search and scroll-based browsing by collection |

¹ Create only — dropping a database isn't a dedicated action yet; run a raw `DROP DATABASE` query if your credentials allow it.
² No native dump utility for this engine — falls back to a portable SQL `INSERT`-based dump.
³ Read-only: `find`/scan-style queries. Writes (insert/update/delete) aren't exposed through the query editor or AI agent yet.
⁴ Database creation isn't a plain SQL statement on this engine (it's an instance-level DBA operation) — user creation is still supported via the AI agent's admin tools where applicable.

### Looking for an admin UI for a specific database?

Pilotbase is a single tool that covers all of these — no separate installs needed.

- **PostgreSQL** — pgAdmin alternative, PostgreSQL web UI, Postgres admin panel, Postgres query browser
- **MySQL / MariaDB** — phpMyAdmin alternative, MySQL admin UI, MariaDB web interface, MySQL query tool
- **SQLite** — SQLite admin, SQLite browser, SQLite GUI, SQLite web viewer, SQLite editor online
- **SQL Server** — MSSQL admin UI, SQL Server web client, SQL Server query tool, SSMS alternative
- **Oracle** — Oracle SQL Developer alternative, Oracle web admin, Oracle query tool
- **Db2** — Db2 admin UI, Db2 web client, Db2 query tool
- **CockroachDB** — CockroachDB admin UI, CockroachDB web console alternative
- **Snowflake** — Snowsight alternative, Snowflake web query tool, Snowflake admin UI
- **MongoDB** — MongoDB admin, MongoDB Compass alternative, MongoDB web UI, Mongo document browser
- **Redis** — RedisInsight alternative, Redis web UI, Redis admin panel, Redis key browser, Redis GUI
- **Cassandra** — Cassandra admin UI, CQL query tool, Cassandra web client
- **DynamoDB** — DynamoDB admin UI, DynamoDB web client, DynamoDB table browser
- **Qdrant** — Qdrant UI, Qdrant admin panel, Qdrant web interface, vector database GUI
- **ChromaDB** — ChromaDB admin, ChromaDB UI, ChromaDB web viewer, Chroma vector browser
- **Weaviate** — Weaviate admin, Weaviate UI, Weaviate web interface, Weaviate console alternative
- **Pinecone** — Pinecone admin UI, Pinecone web client, Pinecone vector browser
- **Milvus** — Milvus admin UI, Milvus web client, Milvus vector browser

---

## Using the AI Agent

1. Select any connection in the left sidebar
2. Open the **AI** panel from the right sidebar
3. Ask anything in plain English

Example prompts:
- *"List all tables and their row counts"*
- *"Find all orders placed in the last 7 days with amount over $500"*
- *"Are there any duplicate email addresses in the users table?"*
- *"Describe the schema of the products table"*
- *"What indexes exist on the orders table?"*

The agent automatically inspects your schema and picks the right query strategy. For write operations (INSERT, UPDATE, DELETE, DROP), it will always explain what it plans to do and ask for confirmation first.

---

## Authentication

By default Pilotbase uses anonymous authentication — a `user_anon_id` is stored in a browser cookie, no login required. This is ideal for self-hosted single-user or trusted-network deployments.

To add custom authentication, implement the `AuthBackend` abstract class in `api/app/auth/base.py` and set the `AUTH_BACKEND` env var to the dotted Python path of your implementation. The interface supports any mechanism: JWT, session cookies, OAuth2, LDAP, or API keys.

---

## Project Structure

```
pilotbase/
├── api/                        # FastAPI backend (Python 3.13)
│   ├── main.py                 # Uvicorn entry point
│   ├── requirements.txt
│   └── app/
│       ├── config.py           # Pydantic settings
│       ├── database.py         # SQLAlchemy engine for Pilotbase's own DB
│       ├── models/             # ORM models (User, DbConnection, etc.)
│       ├── routers/            # REST API routes
│       ├── services/           # DB adapters, backup, migration services
│       ├── agents/             # LangGraph AI agent + tools
│       ├── auth/               # Pluggable auth backend interface
│       └── websocket/          # Real-time WebSocket manager
├── ui/                         # React + Vite frontend (TypeScript)
│   └── src/
│       ├── components/
│       │   ├── layout/         # TopBar, LeftPanel, RightPanel, MainArea
│       │   ├── db/             # ConnectionTree, QueryEditor, ResultsTable, VectorChunksView
│       │   └── common/         # Logo and shared components
│       ├── hooks/              # useWebSocket, useUserSession
│       ├── store/              # Zustand global state
│       └── types/              # Shared TypeScript types
├── Dockerfile                  # Multi-stage build (Node 20 → Python 3.13 slim)
├── docker-compose.yml          # Self-hosted stack
└── LICENSE                     # MIT
```

---

## Roadmap

- [x] Multi-type connection management with encrypted credential storage
- [x] Monaco SQL editor with keyboard shortcuts and results table
- [x] Schema / collection tree browser
- [x] NoSQL document viewer (MongoDB)
- [x] Vector chunk browser with ANN search (Qdrant, ChromaDB, Weaviate)
- [x] LangGraph AI agent with natural language querying
- [x] Per-connection user access control
- [-] Token-based invite links *(backend done — UI in progress)*
- [-] Schema migration: diff and apply across two connections *(backend done — UI in progress)*
- [-] Scheduled and on-demand database backups *(backend done — UI in progress)*
- [ ] Query history and saved queries
- [ ] ER diagram view
- [ ] Full user/role management UI
- [ ] Custom auth backend examples and documentation

---

## Contributing

Contributions are welcome.

### Good first contributions

- **Testing supported databases** — try Pilotbase against the databases it claims to support and report what breaks.
- **Test scripts** — add automated tests for adapters, auth backends, or UI components.
- **UI improvements** — React + TypeScript, Tailwind, Zustand for state. Components are small and isolated under `ui/src/components/`.
- **Security** — review auth flows, connection handling, and query execution for issues.
- **Bug fixes and docs** — always welcome, no issue required.

### How to submit

1. Fork the repo and create a feature branch
2. Open an issue first for large features or breaking changes
3. Submit a pull request against `master`

---

## Screenshots

> Screenshots coming soon. To contribute screenshots, open a PR adding them to `docs/screenshots/`.

<!-- Uncomment as screenshots are added:
![Connection Tree showing multiple DB types](docs/screenshots/connection-tree.png)
![Monaco SQL editor with results table](docs/screenshots/query-editor.png)
![Vector chunk browser with similarity search](docs/screenshots/vector-chunks.png)
![AI agent answering a natural language question](docs/screenshots/ai-agent.png)
-->

---

## License

[MIT](LICENSE) — free to use, modify, and self-host.

---

## Pilotbase.pro — Coming July 2026

Don't want to run the stack yourself? **Pilotbase.pro** is a subscription service launching July 2026 that hosts Pilotbase for you — with a private, dedicated container provisioned near your databases, so you connect and query with zero infrastructure to manage. Same Pilotbase, fully managed.
