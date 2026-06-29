# Pilotbase

**The first open-source database admin that unifies relational, NoSQL, and vector databases in one interface.**

Stop juggling pgAdmin, MongoDB Compass, RedisInsight, and separate vector DB dashboards. Pilotbase connects to your entire data stack — PostgreSQL, MySQL, SQLite, MongoDB, Redis, Qdrant, ChromaDB, Weaviate — and lets you query, browse, and manage everything from a single, modern web UI with an AI agent built in.

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
- **Relational (SQL)** — PostgreSQL, MySQL, MariaDB, SQLite, Microsoft SQL Server
- **NoSQL** — MongoDB (find queries + aggregation pipelines), Redis (native command interface)
- **Vector** — Qdrant, ChromaDB, Weaviate — browse embeddings, run similarity search, view and edit payloads

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

### Coming Soon
- **Schema Migration** — diff two databases, preview changes, generate and apply migration scripts
- **Backup & Restore** — schedule or trigger on-demand database backups, downloadable from the UI
- **Query History** — saved and recent queries per connection
- **ER Diagram View** — visual schema explorer

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

### Frontend (with hot reload)

In a separate terminal:

```bash
cd ui
npm install
npm run dev   # starts on http://localhost:5173
```

The Vite dev server proxies `/api` to the backend automatically.

---

## Configuration Reference

All settings are read from environment variables or `api/.env`.

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase` | Pilotbase's own internal store |
| `SECRET_KEY` | `change-me` | JWT signing secret — **always override in production** |
| `ENCRYPTION_KEY` | `change-me-must-be-valid-fernet-key=` | Fernet key for stored DB credentials — **always override in production** |
| `OLLAMA_BASE_URL` | `http://localhost:11434/v1` | OpenAI-compatible LLM base URL |
| `OLLAMA_MODEL` | `deepseek-r1` | Primary reasoning model for the AI agent |
| `OLLAMA_FLASH_MODEL` | `deepseek-v3` | Faster model for lightweight agent steps |
| `OLLAMA_API_KEY` | `ollama` | API key (`ollama` for local, real key for hosted providers) |
| `AUTH_BACKEND` | `anon` | `anon` for single-user/anonymous, or dotted path to a custom `AuthBackend` class |
| `ENVIRONMENT` | `development` | Set to `production` for tighter CORS and security defaults |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Comma-separated allowed origins |

**Using a hosted LLM instead of Ollama:**

Set `OLLAMA_BASE_URL` to any OpenAI-compatible endpoint and provide the appropriate `OLLAMA_API_KEY`. Works with OpenAI, Groq, Together AI, Anthropic (via proxy), and others.

---

## Supported Databases

| Database | Protocol | Notes |
|---|---|---|
| PostgreSQL | SQL | Multi-database, schema browsing, user/DB creation |
| MySQL / MariaDB | SQL | Full database listing, user management |
| SQLite | SQL | Provide the file path as the database field |
| Microsoft SQL Server | SQL | Uncomment `pyodbc` in `requirements.txt`, install `unixodbc-dev` |
| MongoDB | NoSQL | JSON find queries and aggregation pipelines |
| Redis | Key-Value | Native Redis command interface (KEYS, GET, HGETALL, etc.) |
| Qdrant | Vector | ANN similarity search, scroll-based browsing, payload editing |
| ChromaDB | Vector | Text and embedding queries, document browsing |
| Weaviate | Vector | GraphQL queries and scroll browsing |

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
- [x] Token-based invite links
- [ ] Schema migration: diff and apply across two connections
- [ ] Scheduled and on-demand database backups
- [ ] Query history and saved queries
- [ ] ER diagram view
- [ ] Full user/role management UI
- [ ] Custom auth backend examples and documentation

---

## Contributing

Contributions are welcome — bug fixes, new database adapters, UI improvements, and documentation all appreciated.

1. Fork the repo and create a feature branch
2. Open an issue first for large features or breaking changes
3. Submit a pull request against `master`

---

## License

[MIT](LICENSE) — free to use, modify, and self-host.
