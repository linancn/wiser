---
title: WISER multi-system platform
description: Long-term system boundaries for WISER, Agent EXCON, Data Foundation, and their shared hosts.
docType: architecture
scope: wiser-platform
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when adding a system, shared capability, or deployable
  - when changing cross-system dependencies, authority, or composition hosts
whenToUpdate:
  - when the system catalog, dependency direction, data authority, or completion gate changes
checkPaths:
  - apps/**
  - packages/**
  - infrastructure/**
  - supabase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 283879984de8a5d65d71c384bef90da2cd5ca541
---

## Decision summary

WISER is the product and platform context. Agent EXCON and Data Foundation are peer business systems, not feature folders inside each other. They reuse one Fastify, Next.js, MCP, Fumadocs, Supabase Auth, and observability entry surface while retaining separate domains, application use cases, workers, and authoritative facts.

The composition roots wire unified Supabase Auth, platform identity/delegation, the durable EXCON v2 command journal, Data Capabilities, REST, GraphQL, MCP/Skill, system workers, projections, and bilingual Web. `pnpm stack:full:up` starts the default complete stack inside one platform identity boundary and runs the Data smoke. v1 Episodes remain an explicit in-memory compatibility path, not the unified platform's durable runtime.

“Unified identity” means one Supabase/Platform authority and authorization context, not one interactive credential reused by every client. Data Web uses the human Supabase SSR session; EXCON live Web uses a server-side operator credential; the MCP transport bearer, EXCON RunAgent credential, and Data API identity protect different boundaries and are not interchangeable.

## System boundaries

| Context         | Owns                                                                             | Does not own                                           |
| --------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------ |
| WISER Platform  | identity request context, tenants, projects, shared hosts, technical conventions | EXCON verdicts, data versions, search projections      |
| Agent EXCON     | Scenario, Run, Task, Receipt, Artifact, Submission, Evaluation, Feedback         | data catalog, general object storage, data projections |
| Data Foundation | DataItem, Version, Asset, Quality, Lineage, Publication, Knowledge, Search, GIS  | user sessions, EXCON Runs and verdicts                 |

An EXCON scenario publication may pin only immutable data references: `dataItemVersionId`, `contentHash`, and an authorization snapshot. An exercise must never resolve a mutable “latest” Data Foundation version at runtime because that would make replay and verification impossible.

## Shared hosts and call direction

```text
Web / MCP / Skill
       │ HTTP
       ▼
WISER Fastify composition root
       ├── Agent EXCON adapter → application → Supabase/PostgreSQL
       └── Data adapter        → application → data-postgres / S3
                                               └── Outbox → Worker → projections
```

- API, MCP, and Web use compile-time static registration. They do not scan the TypeScript AST or discover runtime plugins.
- REST and GraphQL call the same Capability Handler inside the API process.
- MCP, Skills, and browsers call only HTTP APIs; they neither import business handlers nor connect to databases.
- A system may depend only on another system's public contracts or HTTP client, never its core or infrastructure.
- Every authoritative database owns its transactions, Outbox, and audit. Supabase, data-postgres, and object storage never pretend to form one distributed atomic transaction.

## Authority matrix

| Store/service                  | Authoritative content                                        | Consistency rule                                                         |
| ------------------------------ | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Supabase Auth/PostgreSQL       | users, sessions, tenants, projects, memberships, EXCON facts | single WISER identity and control plane                                  |
| data-postgres/PostGIS          | DataItems, versions, quality, lineage, Operations, Outbox    | structured Data Foundation authority                                     |
| S3-compatible object store     | source objects and immutable version assets                  | content addressed; committed by a PostgreSQL manifest after verification |
| OpenSearch/Weaviate/Neo4j/STAC | search, graph, and external GIS projections                  | disposable, rebuildable, idempotent, never authorization authority       |
| GeoServer/TiTiler/Martin       | none; Compose-internal GIS serving only                      | fixed origins, no host ports, every request traverses API                |
| OpenTelemetry                  | technical diagnostic projection                              | sampled; never business state, authorization, or adjudication            |

Projections push down Tenant, Project, Version, security-level, and policy-version filters, but authoritative authorization is checked again before returning, downloading, exporting, or publishing content. A stale policy projection fails closed.

## Package dependency contract

```text
platform contracts
        ↑
system contracts
        ↑
system core
        ↑
system application ← system infra
        ↑                 ↑
transport adapters ──────┘
```

Core remains pure and deterministic. Application owns use cases, Ports, and Capability Handlers. Infrastructure implements database, object-store, AI, search, and GIS adapters. Apps only compose and transport.

## Platform-wide contracts

- Chinese is the default; English routes, states, and capabilities are isomorphic.
- Every system uses the WISER Design System and supports persistent light and dark themes.
- Every added or upgraded npm package uses the latest compatible stable release confirmed at implementation time, an exact version, and the shared lockfile.
- Docker images use the latest compatible stable tag confirmed at implementation time and also pin a digest; `latest` is forbidden.
- Every behavior starts with a test that fails for the expected reason, followed by the minimal implementation. Every Green milestone runs `pnpm verify`.
- Applied database migrations are immutable and corrected only by forward migrations.

## Verification boundary

Executable commands prove the platform boundary; prose does not. `pnpm verify` covers formatting, lint, types, unit/component tests, builds, and Compose configuration. Supabase, Data, browser, observability, and documentation governance have additional focused gates. See [Testing and verification](/en/development/testing/) for the complete matrix.
