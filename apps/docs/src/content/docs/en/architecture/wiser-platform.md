---
title: WISER multi-system platform
description: Long-term boundaries and the single reconstruction contract for WISER, Agent EXCON, Data Foundation, and their shared hosts.
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
lastReviewedAt: 2026-08-21
lastReviewedCommit: a395ed8aef5615b780ebbc39aa1f678e617acfda
---

## Decision summary

WISER is the product and platform context. Agent EXCON and Data Foundation are peer business systems, not feature folders inside each other. They reuse one Fastify, Next.js, MCP, Fumadocs, Supabase Auth, and observability entry surface while retaining separate domains, application use cases, workers, and authoritative facts.

The reconstruction is one continuous delivery objective. Internal Red → Green → Refactor phases and frequent commits provide recovery points, but no intermediate phase represents full delivery. Completion requires Agent EXCON regression, the complete Data Foundation slice, unified UI, bilingual documentation, both color themes, Compose, CI, and security gates.

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

| Store                                    | Authoritative content                                        | Consistency rule                                                         |
| ---------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Supabase Auth/PostgreSQL                 | users, sessions, tenants, projects, memberships, EXCON facts | single WISER identity and control plane                                  |
| data-postgres/PostGIS                    | DataItems, versions, quality, lineage, Operations, Outbox    | structured Data Foundation authority                                     |
| S3-compatible object store               | source objects and immutable version assets                  | content addressed; committed by a PostgreSQL manifest after verification |
| OpenSearch/Weaviate/Neo4j/STAC/GeoServer | search, graph, and GIS projections                           | disposable, rebuildable, idempotent, never authorization authority       |
| OpenTelemetry                            | technical diagnostic projection                              | sampled; never business state, authorization, or adjudication            |

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

## Global delivery constraints

- Chinese is the default; English routes, states, and capabilities are isomorphic.
- Every system uses the WISER Design System and supports persistent light and dark themes.
- Every added or upgraded npm package uses the latest compatible stable release confirmed at implementation time, an exact version, and the shared lockfile.
- Docker images use the latest compatible stable tag confirmed at implementation time and also pin a digest; `latest` is forbidden.
- Every behavior starts with a test that fails for the expected reason, followed by the minimal implementation. Every Green milestone runs `pnpm verify`.
- Applied database migrations are immutable and corrected only by forward migrations.

## Completion boundary

The reconstruction is complete only when existing EXCON behavior and compatibility remain intact; unified Supabase Auth is active; Data Foundation runs from upload, scanning, interpretation, deterministic transformation, and quality checks through authoritative commit, all projections, and REST/GraphQL/MCP/Web queries; and unified documentation, UI, themes, observability, and CI all pass.
