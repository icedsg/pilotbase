# Pilotbase vs Weaviate Cloud Console

Weaviate is unusual among vector databases in that its strongest official GUI is tied to its managed cloud offering rather than to self-hosting, which shapes this comparison differently than the others in this series.

If you run Weaviate through Weaviate's own managed cloud offering, you already have access to the **Weaviate Cloud Console** — the official web interface for managing Weaviate Cloud clusters. It's a strong tool, but it's tied to one specific way of running Weaviate. This doc looks honestly at where Pilotbase fits alongside it, including for the (very common) case of self-hosted Weaviate, where the Cloud Console isn't available at all.

## What each tool is

**Weaviate Cloud Console** is Weaviate's official management interface for clusters provisioned through Weaviate Cloud. It covers cluster provisioning and monitoring, schema/class configuration, module management (vectorizers, rerankers, generative modules), and a query tool for running GraphQL/BM25/hybrid searches against your data. It's deeply tied to Weaviate's own hosted infrastructure — if you're self-hosting Weaviate yourself (a common setup, since Weaviate is open source), the Cloud Console isn't part of your stack at all, and you're generally left with community query tools or hand-rolled scripts against the GraphQL/REST API.

**Pilotbase** is an open-source, self-hosted admin tool that treats Weaviate as one of several engines — relational, other NoSQL, and vector — inside a single web UI, with a built-in AI agent that can query and explain schema in plain English. For Weaviate specifically, Pilotbase currently supports GraphQL queries and scroll-based browsing. There's no class/schema configuration, no module management, and no backup or migration tooling for Weaviate yet.

The important distinction here isn't feature-for-feature — it's *availability*. The Cloud Console only exists for one hosting model; Pilotbase works the same way regardless of how or where Weaviate is running, which matters a lot given how many Weaviate deployments are self-hosted.

## Comparison

| Capability | Pilotbase | Weaviate Cloud Console |
|---|---|---|
| Works with self-hosted Weaviate | Yes | No — Weaviate Cloud only |
| GraphQL query / scroll browsing | Yes | Yes |
| Class/schema configuration | No | Yes |
| Module management (vectorizers, rerankers, generative) | No | Yes |
| Cluster provisioning/monitoring | No — not applicable | Yes |
| Hybrid/BM25 search tooling | Via raw GraphQL | Yes, built-in query tool |
| AI agent (plain-English querying) | Yes, schema-aware | No |
| Multi-database support (SQL, other NoSQL, other vector DBs) | Yes, one UI | No — Weaviate only |
| Self-hosted, source-available | Yes | Console itself isn't self-hostable; tied to Weaviate Cloud accounts |
| Cost | Free (self-hosted) | Included with a Weaviate Cloud account |
| Schema migration / backups | Not yet | Cluster-level backup features exist for Cloud, not a general migration tool |

## Who each tool is for

If you're on Weaviate Cloud and responsible for the cluster itself — provisioning, scaling, module/vectorizer configuration — the Cloud Console is not optional; it's the account management surface. If you're self-hosting Weaviate, or you're a consumer of Weaviate data rather than its administrator, Pilotbase (or a community query tool) is closer to what you actually need day-to-day.

## Where Weaviate Cloud Console wins

- **Deep Weaviate-specific configuration.** Class schemas, vectorizer/module setup, and reranking pipelines are configured with a level of detail Pilotbase doesn't attempt.
- **Cluster operations.** Provisioning, scaling, and monitoring a Weaviate Cloud cluster happens here and only here.
- **Official support and guaranteed compatibility** with Weaviate Cloud's release cadence, maintained directly by the Weaviate team.
- **No extra tool to deploy** if you're already paying for Weaviate Cloud — it's included.
- **Built-in hybrid/BM25 query tooling**, rather than needing to hand-write GraphQL for keyword-plus-vector search.

## Where Pilotbase wins

- **Works with self-hosted Weaviate at all.** If you're running open-source Weaviate yourself rather than through Weaviate Cloud, the Cloud Console simply isn't an option — Pilotbase is a real GUI where before there may have been none.
- **One tool for every database you run.** Weaviate plus Postgres plus Redis plus another vector store — one UI, one login, instead of a cloud console for Weaviate and separate tools for everything else.
- **Chunk-level browsing next to your source data.** For RAG pipelines, viewing Weaviate objects and vectors alongside the relational/NoSQL data they were derived from, in one tool, is the actual differentiator.
- **Built-in AI agent.** Plain-English querying against Weaviate data, schema-aware automatically — not something the Cloud Console offers.
- **Not tied to a hosting decision.** Pilotbase works the same whether Weaviate is self-hosted or cloud-hosted; source-available and self-hostable end-to-end.
- **Shared, permissioned access.** Pluggable auth and per-connection read/write/admin grants make it straightforward to give a team controlled access to the same Weaviate instance without everyone sharing one Cloud account.

## Verdict

If you're already on Weaviate Cloud, the Cloud Console is the right home for cluster ops and deep schema/module configuration — that's not a fight Pilotbase is trying to win. But if you self-host Weaviate, the Cloud Console isn't in the picture at all, and Pilotbase fills a real gap: a GUI for querying and browsing your data.

For teams running Weaviate alongside other databases in a RAG pipeline, Pilotbase's cross-database view and AI agent are the differentiators; for deep Weaviate-internals configuration, especially on Weaviate Cloud, the official console is still the more capable tool. The two aren't mutually exclusive — a Weaviate Cloud team can still use Pilotbase day-to-day for cross-database querying while keeping the Cloud Console for cluster administration.
