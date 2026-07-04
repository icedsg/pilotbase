# Pilotbase vs Qdrant Web UI

Both tools are free and self-hosted, and both let you browse and search points in Qdrant — but they were built to answer different questions. One is for administering Qdrant; the other is for looking at Qdrant data next to everything else you run.

Qdrant ships with its own built-in dashboard — a genuinely capable web UI that comes free with any self-hosted Qdrant instance. If Qdrant is the only database in your stack, that dashboard is the obvious starting point. This doc is an honest look at where Pilotbase fits alongside it, not a claim that Pilotbase replaces it today.

## What each tool is

**Qdrant Web UI** is the official dashboard bundled with self-hosted Qdrant (served at the `/dashboard` path). It's built by the Qdrant team specifically around Qdrant's data model and operations: collection creation and configuration (vector size, distance metric, quantization, sharding/replication settings), cluster and shard visibility, a built-in raw REST API console for hitting any Qdrant endpoint directly, and visual exploration of points and payloads. It only speaks Qdrant.

**Pilotbase** is an open-source, self-hosted admin tool that treats Qdrant as one of several engines — relational, other NoSQL, and vector — inside a single web UI, with a built-in AI agent that can query and explain schema in plain English. For Qdrant specifically, Pilotbase currently supports ANN similarity search, scroll-based browsing of points, and inline payload editing (you can edit a point's payload directly in the UI). There's no collection creation/configuration, no cluster management, and no backup or migration tooling for Qdrant yet.

Both tools assume you already have a running Qdrant instance — neither one stands up Qdrant itself. Where they diverge is scope: the Qdrant dashboard is built to administer that one instance in depth, while Pilotbase is built to sit across Qdrant and whatever else you're running, at the cost of not going nearly as deep on Qdrant-specific configuration.

## Comparison

| Capability | Pilotbase | Qdrant Web UI |
|---|---|---|
| ANN similarity search | Yes | Yes |
| Scroll-based point browsing | Yes | Yes |
| Payload editing | Yes (inline) | Yes |
| Collection creation/config (vector size, distance, sharding) | No | Yes |
| Cluster/shard visibility | No | Yes |
| Raw REST API console | No | Yes, built in |
| Multi-tenancy / API key management | No | Yes |
| AI agent (plain-English querying) | Yes, schema-aware | No |
| Multi-database support (SQL, other NoSQL, other vector DBs) | Yes, one UI | No — Qdrant only |
| Self-hosted, open source | Yes (MIT) | Yes, bundled with Qdrant |
| Deployment | One app for every connection you add | Comes free with self-hosted Qdrant, no extra deploy |
| Schema migration / backups | Not yet | Not really its job either (some snapshot ops via API, not GUI-driven) |

## Who each tool is for

The Qdrant dashboard is the right tool if you're the person responsible for standing up and operating Qdrant itself — sizing collections, choosing distance metrics and quantization, watching shard health. Pilotbase is the right tool if you're the person (or team) consuming data out of Qdrant day-to-day, especially when that data needs to be cross-referenced against records in a relational or NoSQL database. Those are frequently different people on the same team, which is part of why running both isn't unusual.

## Where Qdrant Web UI wins

- **Collection and cluster management.** Creating collections, tuning distance metrics and quantization, and watching shard/replication state are things only the Qdrant dashboard does — Pilotbase doesn't touch this layer yet.
- **Built-in REST console.** Being able to hit any Qdrant API endpoint directly from the dashboard is a genuinely useful escape hatch that Pilotbase doesn't have.
- **Zero extra setup.** It's already running the moment you start Qdrant — nothing else to deploy or configure.
- **Purpose-built depth.** Every feature is tuned to Qdrant's specific internals, maintained by the people who build Qdrant.
- **API key and multi-tenancy controls.** Managing access at the Qdrant-cluster level is handled here, not in Pilotbase's connection-level permission model.

## Where Pilotbase wins

- **One tool for every database you run.** If your stack is Qdrant plus Postgres plus Mongo, Pilotbase is one UI and one set of credentials instead of switching tabs between a relational tool and the Qdrant dashboard.
- **Chunk-level browsing next to your source data.** For RAG pipelines, being able to look at the embeddings in Qdrant and the source records in Postgres/Mongo in the same tool — without re-authenticating into a separate dashboard — is the actual differentiator.
- **Built-in AI agent.** Ask questions in plain English against your Qdrant data, schema-aware automatically — something the Qdrant dashboard doesn't attempt.
- **Not tied to a single engine's roadmap.** MIT-licensed, so teams running mixed vector/relational stacks aren't stuck maintaining N separate admin tools.
- **Shared team access with permission grants.** Pluggable auth (anonymous by default, or JWT/OAuth2/LDAP/SSO) plus per-connection read/write/admin grants and invite links, useful once more than one person needs access to the same set of databases.

## Verdict

If Qdrant is your only vector database, its own Web UI is hard to beat for collection setup, cluster ops, and the raw API console — it's free, official, and already there. Pilotbase is worth reaching for when Qdrant is one piece of a bigger stack: teams running RAG pipelines who want to browse embeddings and payloads alongside their relational or NoSQL data, and who value AI-assisted querying, are the right fit today.

Pilotbase isn't trying to replace the Qdrant dashboard for collection/cluster administration yet — it's solving a different problem, the cross-database view the Qdrant dashboard was never built for. Many teams will reasonably end up running both: the Qdrant dashboard for standing up and tuning collections, Pilotbase for day-to-day querying across the whole stack.
