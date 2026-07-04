# Pilotbase vs Fauxton (CouchDB's Built-in Web UI)

CouchDB actually ships its own admin UI out of the box — **Fauxton** — which is more than most of the engines Pilotbase supports can say. Fauxton runs directly on the CouchDB server (typically at `/_utils`), so it's always there, always version-matched, and needs no separate install. That makes the comparison less about "does a GUI exist" and more about "do you want a per-database tool bundled with the server, or one multi-engine tool with an AI agent on top."

## Comparison table

| Feature | Fauxton | Pilotbase |
|---|---|---|
| Cost | Free, bundled with CouchDB | Free, open source (MIT) |
| Install | None — served by CouchDB itself at `/_utils` | Self-hosted via Docker Compose or local dev setup |
| Database scope | CouchDB only | CouchDB plus Postgres, MongoDB, Cassandra, vector DBs, and more in one UI |
| Connection model | Points at one CouchDB server it's bundled with | Saved connections with host/port/credentials, shareable with a team |
| Document browsing | Yes, native `_all_docs` grid with inline JSON editing | Yes, via `_all_docs`-backed browsing |
| Mango (`_find`) queries | Yes, built-in query editor | Yes, JSON `{"database", "selector"}` queries through the same editor used for every NoSQL engine |
| Design docs / views | Yes, first-class support for creating and running views | Not yet — Pilotbase's CouchDB support covers document browsing and Mango queries, not view/design-doc management |
| Replication setup | Yes, built-in replication configuration UI | No |
| Cluster/admin config (`_membership`, etc.) | Yes | No — Pilotbase focuses on data browsing and querying, not server administration |
| AI query assistant | No | Yes — plain-English querying, schema-aware, warns before destructive operations |
| Multi-user / access control | CouchDB's own admin/user system | Per-connection read/write/admin permission grants, token-based invite links, layered on top of CouchDB's own auth |
| Works across multiple databases/servers in one screen | No — one Fauxton per server | Yes — one Pilotbase instance across every CouchDB server (and every other engine) you've connected |

## Where Fauxton wins

- **Zero setup, always in sync.** It ships with the server, so there's never a version mismatch or a separate thing to deploy.
- **Deeper CouchDB-specific tooling.** Design documents, views, replication configuration, and cluster membership are all first-class in Fauxton — genuinely CouchDB-specific surface area that a generic multi-engine tool doesn't try to replicate.
- **No credentials to store elsewhere.** You're already authenticated against the server you're looking at; there's no separate connection config to maintain.

## Where Pilotbase wins

- **One tool across many engines.** If CouchDB is one database among several — Postgres, MongoDB, Cassandra, vector stores — Pilotbase gives you one UI and one AI agent for all of them instead of a different bundled admin UI per server.
- **AI agent.** Plain-English querying against CouchDB's Mango query language, with confirmation prompts before destructive changes — Fauxton has no equivalent.
- **Cross-server view.** Multiple CouchDB deployments (dev, staging, a client's server) show up as connections in the same sidebar instead of requiring you to navigate to a different `/_utils` URL for each.

## Should you switch?

If you're deep in CouchDB-specific work — building views, managing design documents, configuring replication — Fauxton remains the more complete tool, because that's exactly the surface area it was built for and Pilotbase doesn't try to cover it yet. Pilotbase's CouchDB support is aimed at the browsing-and-querying half of the job: looking at documents, running Mango queries, and letting an AI agent help you write them, especially when CouchDB is just one of several databases you're already managing in Pilotbase day to day.
