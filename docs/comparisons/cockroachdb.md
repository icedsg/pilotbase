# Pilotbase vs CockroachDB DB Console

Every CockroachDB cluster ships with a built-in web UI called the DB Console — it's the tool CockroachDB's own docs point you to for understanding cluster health, node status, range distribution, and query performance. It is genuinely good at that job because it's built directly into the database and has first-class access to cluster internals. Pilotbase is a different kind of tool entirely: a general-purpose, cross-database query and data-browsing client that happens to support CockroachDB as one of its relational engines, with a retry-aware dialect that handles Cockroach's serializable-isolation transaction retries.

It's important to be clear about what each tool is actually for. The DB Console is a cluster operations and observability tool, not primarily a data-browsing or query-authoring tool. Pilotbase is a query and data tool, not a cluster-ops replacement. They overlap only at the edges (both can run ad hoc SQL), and neither is trying to fully replace the other.

## Feature comparison

| Feature | Pilotbase | CockroachDB DB Console |
|---|---|---|
| Platform | Web UI, self-hosted separately from the cluster | Web UI, bundled with every CockroachDB node |
| Cross-database support | Yes — CockroachDB plus ~15 other relational/NoSQL/vector engines | No — CockroachDB only |
| Cluster health & topology (nodes, ranges, replication) | No | Yes — this is its core purpose |
| Query performance insights / statement diagnostics | No | Yes, built in and cluster-aware |
| General SQL query editor | Yes — Monaco-based, syntax highlighting, results pane | Basic SQL execution exists but is not the tool's focus or strength |
| Data browsing (rows, tables) | Yes — full table/collection inspector | Limited; not designed as a general data browser |
| Schema/object browsing | Tree view of databases, schemas, tables, views | Some schema visibility, secondary to cluster metrics |
| Create database | Yes | Not a typical DB Console workflow |
| Create tables/views | Yes | No |
| Retry-aware handling of serializable transaction retries | Yes — dedicated dialect handling for Cockroach's isolation model | N/A (not a query client) |
| Schema migration (diff + apply) | Yes — diff across two connections, backend complete, UI in progress | No |
| Backups | Yes — portable SQL INSERT-based dump (not Cockroach's native `BACKUP`/enterprise backup format) | No (native backups typically run via SQL `BACKUP` statements or Cockroach's own scheduled backup features, outside the DB Console UI itself) |
| AI natural-language querying | Yes — schema-aware agent, warns before destructive operations | No |
| Licensing / hosting model | Open-source (MIT), self-hosted separately | Ships free with every CockroachDB cluster |

## Where the DB Console wins

- Cluster health and topology visibility — node status, range distribution, replication health — that comes from being built directly into the database engine. Pilotbase has no equivalent and isn't trying to build one.
- Query performance insights and statement diagnostics tuned specifically to Cockroach's distributed execution model.
- Zero extra setup: it's already running the moment your cluster is up, with no separate service to deploy or maintain.
- The authoritative source for understanding *how* your cluster is behaving at the infrastructure level, not just what data is in it.

## Where Pilotbase wins

- A real general-purpose SQL query and data-browsing experience — a proper query editor, table inspector, and schema tree — where the DB Console is comparatively thin.
- Cross-database reach: if your stack includes CockroachDB alongside PostgreSQL, MySQL, or other engines, Pilotbase gives you one interface instead of switching between the DB Console and separate tools for everything else.
- A dedicated retry-aware dialect for Cockroach, which smooths over the transaction retry behavior that Cockroach's serializable isolation model introduces — something a generic SQL client would stumble on.
- Built-in AI agent for plain-English querying and schema explanation, with no equivalent in the DB Console.
- Schema creation, table/view creation, and schema migration (diff across two connections) as first-class workflows — none of which are what the DB Console is built for.
- Self-hosted and open-source, giving teams a consistent query tool independent of any single cluster's bundled UI.

## Verdict

These tools aren't really competing for the same job. The DB Console is essential for operating a CockroachDB cluster — node health, ranges, replication, performance diagnostics — and Pilotbase makes no attempt to replace it there. Where Pilotbase adds real value is on the data side: querying, browsing, schema work, and AI-assisted exploration, done consistently across CockroachDB and whatever else your team runs. In practice, teams running CockroachDB in production will likely want both: the DB Console for cluster ops, Pilotbase for everyday querying and cross-database work.
