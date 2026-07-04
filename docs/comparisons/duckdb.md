# Pilotbase vs DuckDB's Built-in CLI / Notebook Workflow

DuckDB doesn't really have an incumbent GUI the way Postgres has pgAdmin or MongoDB has Compass. Most DuckDB usage happens inside the `duckdb` CLI shell, a Python/pandas notebook, or embedded straight into an app's process — it's an embedded analytical database, not a client-server one, so the "admin tool" question looks different than it does for the rest of Pilotbase's supported engines. The closest things to dedicated GUIs are the DuckDB CLI's own `.mode`/`.timer` niceties and third-party notebook extensions; there's no single dominant desktop or web GUI the way there is for SQLite or Postgres.

## Comparison table

| Feature | `duckdb` CLI / notebook | Pilotbase |
|---|---|---|
| Cost | Free, open source | Free, open source (MIT) |
| Install | Ships with the `duckdb` Python package or a single static binary | Self-hosted via Docker Compose or local dev setup |
| Database scope | DuckDB only | DuckDB plus Postgres, MySQL/MariaDB, SQLite, MongoDB, vector DBs, and more in one UI |
| Connection model | Opens a local `.duckdb` file or `:memory:` directly in-process | File path as the "database" field; accessed through a web UI, shareable with a team |
| Run raw SQL | Yes, DuckDB's full SQL dialect (including `read_csv`/`read_parquet` table functions) | Yes, with syntax highlighting via the standard SQLAlchemy `duckdb-engine` dialect |
| Schema/table browsing | `.tables` / `DESCRIBE` at the shell, or notebook introspection | Yes, visual schema tree browsing |
| Create tables/views | Yes | Yes |
| Create/drop database | N/A (DuckDB is an embedded file, like SQLite) | N/A (same reason — Pilotbase treats it the same way) |
| Backups | Manual (copy the file) | Built-in backup, using a portable SQL INSERT-based dump (DuckDB has no native dump utility to shell out to, same as SQLite) |
| AI query assistant | No | Yes — plain-English querying, schema-aware, warns before destructive operations |
| Multi-user / access control | No — single-process, local file | Per-connection read/write/admin permission grants, token-based invite links |
| Works offline | Yes, fully | No — needs the Pilotbase server running (though that can be entirely local) |

## Where the CLI/notebook workflow wins

- **Zero overhead for analytical, single-user work.** `import duckdb; duckdb.sql(...)` in a notebook, or the `duckdb` binary directly, is faster to reach for than standing up any web app when you're the only one touching the file.
- **First-class Parquet/CSV/Arrow ergonomics.** DuckDB's `read_parquet`/`read_csv` table functions and zero-copy Arrow interop are a big part of why people reach for it, and that's native to the CLI/notebook workflow in a way a general-purpose DB browser doesn't add value to.
- **Fully offline and dependency-free.** No server process, no Docker, no browser tab — just a file and a binary or Python import.

## Where Pilotbase wins

- **One tool across many engines.** If DuckDB is one piece of a stack that also includes Postgres, MongoDB, or vector databases, Pilotbase gives you the same UI and the same AI agent across all of them instead of switching between a notebook and separate GUIs per engine.
- **AI agent.** Plain-English querying and schema explanation, with confirmation prompts before destructive changes — nothing in the DuckDB CLI/notebook workflow offers this out of the box.
- **Web-based and shareable.** A team can share one Pilotbase instance with per-connection permissions and browse/query a shared DuckDB file, rather than everyone needing their own local Python environment and a copy of the file.
- **Visual schema browsing** for people who'd rather click through tables than run `DESCRIBE` at a prompt.

## Should you switch?

If you're doing solo, ad hoc analytical work against Parquet/CSV files or a local `.duckdb` file, the CLI or a notebook remains the faster and more natural fit — that's exactly the workflow DuckDB was designed around. Pilotbase's advantage shows up once a DuckDB file needs to be browsed or queried by more than one person, sits alongside other databases you're already managing day to day, or you want an AI agent that can explain the schema and write queries against it in plain English.
