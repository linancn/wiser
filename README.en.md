---
title: WISER project overview
docType: overview
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when learning the project boundary, delivered state, and local entry points
whenToUpdate:
  - when product boundaries, delivery status, or development entry points change
checkPaths:
  - apps/**
  - packages/**
  - compose.yaml
  - docs/roadmap.md
lastReviewedAt: 2026-08-22
lastReviewedCommit: 574446ae6c540c2e1d365473f6b0d81469ec9367
---

# WISER · Water Intelligence System & Engine for Reconfiguration

English · [中文（默认）](./README.md)

**wiser water, better future**

WISER has evolved from a single agent exercise control application into an extensible multi-system platform. Agent EXCON and Data Foundation are the first two peer business systems. They share Fastify, Next.js, MCP, Fumadocs, Supabase Auth, observability entrypoints, and the WISER Design System while retaining separate domains, authorities, and workers.

## Delivered now

- **Unified platform**: Supabase Auth is the sole authority for users, sessions, tenants, projects, memberships, roles, scopes, and delegated identities. Web uses the same SSR session, and API requests re-resolve live authorization context.
- **Agent EXCON**: the v2 multi-scenario/multi-RunAgent protocol, 18 MCP Tools, deterministic evaluation, Receipt replay, and observatory remain intact. The full stack journals all 19 v2 mutations in append-only PostgreSQL tables through a non-superuser role and verifies deterministic replay at startup. v1 Episodes remain an explicit, non-durable compatibility protocol.
- **Data Foundation**: REST, schema-first GraphQL, MCP, and the file-based Skill share one Zod contract and Handler for 22 Capabilities. Independent data-postgres/PostGIS, SeaweedFS S3, a durable Worker, Transactional Outbox, five PostGIS/Weaviate/OpenSearch/Neo4j/STAC projections, and governed query adapters are wired into the default Data runtime. OGC/STAC/vector/raster data is exposed only through the unified-Auth Fastify proxy; all four GIS backends have no host port.
- **Unified product UI**: Data Foundation catalog, immutable-version selection, ingestion, quality, lineage, knowledge, graph, GIS, Operation, and Capability views live in the existing Next.js app. Its map combines PostGIS authority, STAC extent, vector MVT, and raster through a same-origin Session proxy. Every visible message exists in `zh-CN` and `en`, Chinese is the default, and the Agent EXCON light/dark responsive shell is reused.
- **Unified documentation**: bilingual architecture, quick start, and Agent EXCON/Data REST, GraphQL, and MCP references are published by one Fumadocs app and governed by Docpact.

## Repository boundaries

```text
apps/           Shared API, Web, MCP, docs, and system-specific workers
packages/       Platform contracts/auth and system contracts/core/infra
infrastructure/ Exact images, Data Foundation, Docker, and observability config
skills/         Independently loadable Agent EXCON and Data Foundation Skills
supabase/       Unified Auth/control plane, EXCON schema, migrations, seeds, pgTAP
scenarios/      Versioned exercise scenarios and provenance
tests/          Cross-boundary fixtures and acceptance tests
```

Dependency direction is `platform contracts <- system contracts <- core <- application <- infra/apps`. MCP, Skills, and browsers call only HTTP; they never connect directly to an authority database or projection. Data projections are rebuildable and never authorization or publication authority.

## Environment baseline

- Node.js 24 LTS (`>=24.18.0 <25`)
- pnpm `11.22.0`
- TypeScript `7.0.2`
- Docker Engine 29+ / Docker Compose 5+
- workspace-pinned Supabase CLI

npm dependencies are exact and share one `pnpm-lock.yaml`. Containers use a stable tag plus `sha256` digest; Data Foundation pins are audited in [`infrastructure/data-foundation/versions.env`](./infrastructure/data-foundation/versions.env), and `latest` is forbidden.

Key application pins in this delivery are AWS S3 SDK/presigner `3.1116.0`, Next.js `16.3.2`, Fumadocs core/UI `16.15.0` with MDX `15.3.1`, and MapLibre GL JS `6.5.0`. pnpm retains the 24-hour `minimumReleaseAge` for everything else and narrowly exempts only the just-verified, exactly pinned AWS/Smithy, Next, Fumadocs, and MapLibre packages. GraphQL `16.14.2` with Mercurius `16.10.0` is the validated Fastify 5/TS7 line; `@types/node` `24.13.3` deliberately matches Node 24 rather than a different runtime major.

## Install and verify

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm supabase:verify
pnpm data:verify
```

The repository uses Docpact 0.1.9. Route actual paths before a change, then inspect documentation obligations and validate governance afterward:

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'packages/data-core/src/**'
pnpm docpact:check
pnpm docpact:validate
```

## Start the complete platform

One command starts Supabase, unified Auth, durable EXCON v2, Data Foundation, API, Web, MCP, and docs, then runs migrations, seeds, and the real 18-step smoke:

```bash
pnpm stack:full:up
```

`stack:full:up` creates and reuses local keys in the ignored `.wiser/local/runtime-secrets.json`, provisions the EXCON journal's non-superuser login, and runs `data:up → data:migrate → data:seed → data:smoke`. It neither reads nor mounts `~/.codex/auth.json`, and it never injects a Supabase service-role key into applications.

| Surface               | Address                                   |
| --------------------- | ----------------------------------------- |
| WISER Web             | `http://127.0.0.1:3000/zh-CN`             |
| Fastify API / GraphQL | `http://127.0.0.1:3001` / `POST /graphql` |
| Fumadocs              | `http://127.0.0.1:4321`                   |
| Data Worker           | `http://127.0.0.1:13003/health/ready`     |
| MCP Streamable HTTP   | `http://127.0.0.1:13004/mcp`              |
| Supabase Studio       | `http://127.0.0.1:56323`                  |

For individual steps:

```bash
pnpm supabase:start
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
```

`data:smoke` uploads real GeoJSON and Markdown fixtures, traverses ClamAV, SHA-256, Tika/GeoJSON parsing, fake-AI planning, deterministic transformation, quality/manual review, authoritative commit, Outbox, and five projections, then verifies REST, GraphQL, MCP, and the authenticated Web catalog. It replays the same Outbox event and proves that no duplicate version, object, node, or projection appears.

Normal shutdown preserves data:

```bash
pnpm data:down
pnpm stack:down
```

Removing Data Foundation volumes requires exact confirmation:

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

## Explicit compatibility boundaries

- EXCON v2 in production/full-stack mode uses a single-writer append-only command journal plus deterministic replay. It is not a normalized PostgreSQL repository for every v2 aggregate. Journal lock, hashes, generation tape, and secret-reference verification fail closed.
- v1 Episodes remain an explicit in-memory compatibility implementation; v2 failures never downgrade automatically.
- Data Foundation Web is currently an authenticated governance and query workspace. Upload, submit, and review mutations are invoked through REST, GraphQL, MCP, or the Skill; the browser never receives database, object-store, or projection credentials.
- Fake AI and embeddings exist for tests, CI, and repeatable local smoke only. Deterministic rules and human review retain authority over quality, acceptance, and publication.

See [Quick start](./apps/docs/src/content/docs/en/quick-start.md), [Data Foundation architecture](./apps/docs/src/content/docs/en/architecture/data-foundation.md), and [`CONTRIBUTING.md`](./CONTRIBUTING.md) for details.

## License

Code is available under the [MIT License](./LICENSE). Scenario data and third-party material retain the licenses in their own `PROVENANCE.md`; MIT does not automatically cover those assets.
