# Supported Databases

*Feature support current as of `v0.1.0-beta.2`.*

| Database | Type | Create/Drop DB | Create Tables | Create Views | Querying | Migration | AI Agent Query | Backups | Notes |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|---|
| PostgreSQL | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Multi-database, schema browsing, user/DB creation |
| MySQL / MariaDB | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full database listing, user management |
| SQLite | SQL | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Provide the file path as the database field |
| DuckDB | SQL | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Embedded analytical SQL; provide the file path (or `:memory:`) as the database field. DuckDB holds an exclusive lock on the file while Pilotbase is connected, so other DuckDB clients must close it first⁵ |
| Microsoft SQL Server | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Uses `pymssql` (FreeTDS) — no proprietary ODBC driver needed |
| Oracle Database | SQL | ❌⁴ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | `oracledb` thin mode — no Instant Client install required |
| Db2 (LUW) | SQL | ❌⁴ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Query/browse parity; no SQL-level database/user creation |
| CockroachDB | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Postgres wire-compatible, dedicated retry-aware dialect |
| Snowflake | SQL | ✅¹ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅² | Connects via account identifier + optional warehouse/role |
| MongoDB | NoSQL | ❌ | ❌ | ❌ | ✅³ | ❌ | ✅³ | ❌ | JSON find queries and aggregation pipelines |
| Redis | Key-Value | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Native Redis command interface (KEYS, GET, HGETALL, etc.) |
| Cassandra | NoSQL | ❌ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | Raw CQL queries, keyspace/table browsing |
| CouchDB | NoSQL | ❌ | ❌ | ❌ | ✅³ | ❌ | ✅³ | ❌ | Mango (`_find`) queries and `_all_docs` browsing; no view/design-doc management yet |
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
⁵ A `:memory:` DuckDB is a scratch database shared by every Pilotbase request and discarded when the server stops. Primary keys, foreign keys, and indexes are read from DuckDB's own catalog (`duckdb_constraints()` / `duckdb_indexes()`), so the table inspector, migration diff, backups, and SQL export all see them.

## Authentication options per engine

Every saved credential — password, API key, and bearer token — is stored Fernet-encrypted with `ENCRYPTION_KEY`; only a live adapter ever sees the plaintext.

| Engine | Username / password | API key | Bearer token | Notes |
|---|:---:|:---:|:---:|---|
| PostgreSQL, MySQL/MariaDB, SQL Server, Oracle, Db2, CockroachDB | ✅ | — | — | |
| SQLite, DuckDB | — | — | — | Local file, no auth |
| Snowflake | ✅ | — | ✅ OAuth | Bearer token is sent as `authenticator=oauth` + `token`; the password is ignored when a token is set |
| MongoDB, Cassandra | ✅ | — | — | DataStax Astra: username `token`, password = your `AstraCS:…` token |
| Redis | password only | — | — | |
| CouchDB | ✅ | — | ✅ JWT | `Authorization: Bearer <JWT>` for CouchDB's `jwt_authentication_handler`; username/password ignored when set |
| DynamoDB | access key / secret | — | — | |
| Qdrant | — | ✅ | ✅ JWT | API key goes in the `api-key` header; an optional RBAC JWT (signed with that key) goes in `Authorization: Bearer` |
| ChromaDB | — | ✅ | (= API key) | The API key *is* the bearer token: sent as `Authorization: Bearer` |
| Weaviate | — | ✅ | ✅ OIDC | Bearer access token (OIDC / Weaviate Cloud) takes precedence over the API key |
| Pinecone | — | ✅ | — | |
| Milvus | — | ✅ | (= API key) | Milvus / Zilliz Cloud token, sent as `Authorization: Bearer` |

## Looking for a database GUI, browser, or client for a specific database?

Whether you'd call it a database admin UI, a db browser, a SQL client, or a database IDE, Pilotbase is a single tool that covers all of these — no separate installs needed. Each entry below also links to a detailed, honest comparison against the tool you're probably already using.

- **PostgreSQL** — pgAdmin alternative, PostgreSQL web UI, Postgres admin panel, Postgres query browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/postgresql.md)
- **MySQL / MariaDB** — phpMyAdmin alternative, MySQL admin UI, MariaDB web interface, MySQL query tool. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/mysql.md)
- **SQLite** — SQLite admin, SQLite browser, SQLite GUI, SQLite web viewer, SQLite editor online. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/sqlite.md)
- **DuckDB** — DuckDB GUI, DuckDB admin UI, DuckDB web viewer, embedded analytical database browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/duckdb.md)
- **SQL Server** — MSSQL admin UI, SQL Server web client, SQL Server query tool, SSMS alternative. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/sql-server.md)
- **Oracle** — Oracle SQL Developer alternative, Oracle web admin, Oracle query tool. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/oracle.md)
- **Db2** — Db2 admin UI, Db2 web client, Db2 query tool. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/db2.md)
- **CockroachDB** — CockroachDB admin UI, CockroachDB web console alternative. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/cockroachdb.md)
- **Snowflake** — Snowsight alternative, Snowflake web query tool, Snowflake admin UI. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/snowflake.md)
- **MongoDB** — MongoDB admin, MongoDB Compass alternative, MongoDB web UI, Mongo document browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/mongodb.md)
- **Redis** — RedisInsight alternative, Redis web UI, Redis admin panel, Redis key browser, Redis GUI. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/redis.md)
- **Cassandra** — Cassandra admin UI, CQL query tool, Cassandra web client. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/cassandra.md)
- **CouchDB** — CouchDB admin UI, Fauxton alternative, CouchDB web client, Mango query tool. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/couchdb.md)
- **DynamoDB** — DynamoDB admin UI, DynamoDB web client, DynamoDB table browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/dynamodb.md)
- **Qdrant** — Qdrant UI, Qdrant admin panel, Qdrant web interface, vector database GUI. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/qdrant.md)
- **ChromaDB** — ChromaDB admin, ChromaDB UI, ChromaDB web viewer, Chroma vector browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/chromadb.md)
- **Weaviate** — Weaviate admin, Weaviate UI, Weaviate web interface, Weaviate console alternative. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/weaviate.md)
- **Pinecone** — Pinecone admin UI, Pinecone web client, Pinecone vector browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/pinecone.md)
- **Milvus** — Milvus admin UI, Milvus web client, Milvus vector browser. [Compare →](https://github.com/icedsg/pilotbase/blob/master/docs/comparisons/milvus.md)

---

← [Back to README](../README.md)
