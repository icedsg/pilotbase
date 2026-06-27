# Pilotbase

*Open source database manager with AI* — a web-based tool for administering databases with a built-in LangGraph AI agent, schema migration diff, and automated backups.

## Features

- **Full DB administration** — browse databases, tables, views; execute queries; create/truncate/drop objects. Supports any SQLAlchemy-compatible database (PostgreSQL, MySQL, SQLite, MSSQL, and more) plus MongoDB, Redis, and vector databases (Qdrant, ChromaDB, Weaviate).
- **Test before save** — every new connection is tested before it can be saved. Errors are shown inline in the connection dialog. For databases that allow connecting without specifying a name (PostgreSQL, MySQL, MongoDB), available databases are listed automatically after a successful test so you can pick one from a dropdown.
- **Admin operations** — create a new database or a new DB user (with optional privilege grant) directly from the UI using an existing admin connection. Supported for PostgreSQL and MySQL/MariaDB.
- **Delete connections** — remove a saved connection from the sidebar with a confirmation prompt.
- **Default connections** — add a `defaultConnections.py` file in the `api/` directory to pre-configure connections that are created automatically on first run and cannot be deleted from the UI (ideal for shared/kiosk deployments).
- **AI chat agent** — powered by LangGraph and Claude, ask questions about your data and database state in natural language.
- **Backup tools** — trigger and download backups, callable from the AI agent.
- **Schema diff & migration** — compare two database schemas and generate migration scripts.
- **Multi-user with invite links** — admin users can invite others via token-based invite links.
- **Drag-and-drop panels** — resizable left/main/right layout with widgets that can be moved between panels. Layout is persisted in browser cookies.
- **WebSocket** — real-time communication between UI and backend.

---

## Quick Start (Docker — recommended)

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) 24+
- [Docker Compose](https://docs.docker.com/compose/install/) v2+

### 1. Clone the repository

```bash
git clone https://github.com/your-org/pilotbase.git
cd pilotbase
```

### 2. Configure environment

Edit `api/.env` and set at minimum:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL URL for Pilotbase's own data (leave default for Docker Compose) |
| `SECRET_KEY` | Random secret for JWT signing — generate with `openssl rand -hex 32` |
| `ENCRYPTION_KEY` | Fernet key for encrypting DB passwords — generate with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` |
| `ANTHROPIC_API_KEY` | Your Anthropic API key (for AI agent) |

### 3. Build and run

```bash
docker compose up --build
```

Pilotbase will be available at **http://localhost:8000**.

> The first run builds the frontend and installs all dependencies inside the image — this may take 2–3 minutes.

---

## Using the Pre-built Registry Image

Once an image is published to a registry, end users can run Pilotbase without building:

```bash
# docker-compose.prod.yml — use the registry image
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: pilotbase
      POSTGRES_USER: pilotbase
      POSTGRES_PASSWORD: your_secure_password
    volumes:
      - pgdata:/var/lib/postgresql/data

  app:
    image: ghcr.io/your-org/pilotbase:latest
    depends_on: [db]
    ports:
      - "8000:8000"
    environment:
      DATABASE_URL: "postgresql+psycopg2://pilotbase:your_secure_password@db:5432/pilotbase"
      SECRET_KEY: "your-secret-key"
      ENCRYPTION_KEY: "your-fernet-key="
      ANTHROPIC_API_KEY: "sk-ant-..."

volumes:
  pgdata:
```

```bash
docker compose -f docker-compose.prod.yml up -d
```

---

## Manual / Development Setup

### Requirements

- Python 3.13+
- Node.js 20 LTS+
- npm 10+
- PostgreSQL 14+ (for Pilotbase's internal database)

### Backend

```bash
cd api
python3.13 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env      # then edit .env
python main.py
```

Backend runs on **http://localhost:8000**.

### Frontend (development with hot reload)

```bash
cd ui
npm install
npm run dev
```

Frontend dev server runs on **http://localhost:5173** and proxies `/api` to the backend.

### Building the frontend for production

```bash
cd ui
npm run build
```

The built files land in `ui/dist/`. Copy them to `api/static/` for FastAPI to serve:

```bash
cp -r ui/dist/* api/static/
```

---

## Environment Variables

### `api/.env`

```env
# Pilotbase internal database (PostgreSQL)
DATABASE_URL=postgresql+psycopg2://pilotbase:pilotbase_secret@localhost:5432/pilotbase

# Security
SECRET_KEY=generate-with-openssl-rand-hex-32
ENCRYPTION_KEY=generate-with-fernet-generate_key

# AI Agent
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-opus-4-8

# App
ENVIRONMENT=development
PILOTBASE_STATIC_DIR=./static
BACKUPS_DIR=./backups
```

### `ui/.env.local`

```env
VITE_API_URL=http://localhost:8000
```

---

## Architecture

```
pilotbase/
├── api/                        # FastAPI backend (Python 3.13)
│   ├── main.py                 # Entry point, uvicorn server
│   ├── requirements.txt
│   ├── .env                    # Environment variables (not committed)
│   └── app/
│       ├── config.py           # Pydantic settings
│       ├── database.py         # SQLAlchemy engine & session for pilotbase DB
│       ├── models/             # ORM models (User, DbConnection, etc.)
│       ├── routers/            # FastAPI route handlers
│       ├── services/           # Business logic (db_service, backup, migration)
│       ├── agents/             # LangGraph AI agent + tools
│       ├── auth/               # Auth interface + anonymous default impl
│       └── websocket/          # WebSocket connection manager
├── ui/                         # React + Vite frontend (TypeScript)
│   ├── src/
│   │   ├── App.tsx             # Root layout (TopBar + panels)
│   │   ├── components/
│   │   │   ├── layout/         # TopBar, LeftPanel, RightPanel, MainArea
│   │   │   ├── widgets/        # ConnectionsWidget, AIChatWidget
│   │   │   ├── db/             # ConnectionTree, QueryEditor, ResultsTable
│   │   │   └── common/         # Logo and shared components
│   │   ├── hooks/              # useWebSocket, useUserSession, usePanelLayout
│   │   ├── store/              # Zustand global state
│   │   ├── api/                # Typed API client
│   │   └── types/              # Shared TypeScript types
│   └── .env.local
├── Dockerfile                  # Multi-stage build (Node → Python 3.13)
├── docker-compose.yml          # Dev/self-hosted (builds locally)
└── README.md
```

## Authentication

By default Pilotbase uses anonymous user IDs (`user_anon_id`) stored in browser cookies. The `api/app/auth/base.py` defines an abstract `AuthBackend` interface — you can swap in any authenticator (JWT, OAuth2, LDAP, SSO) by implementing this interface and setting `AUTH_BACKEND` in the config.

## Contributing

PRs are welcome! Please open an issue first for large changes.

## License

MIT
