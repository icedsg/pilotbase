# Pilotbase Beta 1 — First Public Release

The first public release of Pilotbase — an open-source database admin that connects to relational, NoSQL, and vector databases from a single web UI.

---

## What's included

**Database support**
- SQL: PostgreSQL, MySQL/MariaDB, SQLite, Microsoft SQL Server
- NoSQL: MongoDB (queries + aggregation), Redis (native commands)
- Vector: Qdrant, ChromaDB, Weaviate — browse chunks, run similarity search, edit payloads

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

Supported `db_type` values: `postgresql`, `mysql`, `mariadb`, `sqlite`, `mssql`, `mongodb`, `redis`, `qdrant`, `chromadb`, `weaviate`.

**Option 2 — Add connections from the browser**

Click "Add Connection" in the sidebar and fill in the details. These connections are saved to your browser session via a cookie. If you clear your browser cookies or open Pilotbase in a different browser, the connections will not carry over.

---

## Notes

This is a beta release. Core features are stable but APIs and configuration may change before 1.0. Report bugs and feedback via [GitHub Issues](https://github.com/icedsg/pilotbase/issues).
