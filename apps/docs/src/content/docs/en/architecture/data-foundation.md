---
title: Data Foundation domain architecture
description: Data Foundation authority, ingestion slice, projections, protocols, and verification contract.
docType: architecture
scope: data-foundation
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing Data Foundation DTOs, Capabilities, states, authority, or publication gates
  - when implementing or reviewing data-postgres, object storage, Worker, projections, API, MCP, Skill, or Web
whenToUpdate:
  - when public contracts, transitions, authorities, projections, or completion boundaries change
checkPaths:
  - packages/data-*/**
  - apps/data-worker/**
  - apps/api/src/data-foundation/**
  - apps/mcp/src/data-foundation/**
  - apps/web/src/app/*/data-foundation/**
  - infrastructure/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 8169cc9c274ec3622b9c0ddd8d544eb8afe06f27
---

## Authority boundary

Data Foundation is a WISER business system peer to Agent EXCON. It owns DataItems, immutable versions, assets, ingestion, quality, lineage, knowledge, search, GIS, Operations, and projection facts. It does not own user sessions, tenants, projects, memberships, roles, or tokens. Supabase Auth/PostgreSQL is the unified identity and control plane; independent data-postgres/PostGIS plus S3-compatible object storage form the Data authority.

The default Data runtime composes:

```text
Supabase principal + Tenant/Project/Purpose
  → Fastify REST / schema-first GraphQL
  → one DataCapabilityHandler (22 static executors)
  → data-postgres RLS transaction / SeaweedFS S3
  → PostgreSQL durable job + Transactional Outbox
  → Data Worker
  → PostGIS spatial readiness (inside the same data-postgres)
  → rebuildable external Weaviate / OpenSearch / Neo4j / STAC projections
  → REST / GraphQL / MCP / authenticated Web readback
```

GeoServer, TiTiler, and Martin run as Compose-internal GIS services in the same exactly pinned profile without host-published ports; external access traverses the unified-Auth Fastify GIS proxy. The Outbox ledger has five completion targets. `POSTGIS` establishes/verifies governed `catalog.spatial_extent` representations inside authoritative data-postgres; its source/version/spatial authority rows are not a disposable external projection. Weaviate, OpenSearch, Neo4j, and STAC are rebuildable external projections. No single target decides identity, authorization, acceptance, or publication.

## Packages and dependency direction

| Module                                      | Responsibility                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@wiser/data-contracts`                     | Strict Zod DTOs, 22 Capabilities, four transport mappings                           |
| `@wiser/data-core`                          | Pure ingestion/Operation state, quality, security inheritance, publication gates    |
| `@wiser/data-infra`                         | Checksum migration, PostgreSQL/S3, jobs/Outbox, projections, search, fake embedding |
| `@wiser/data-worker`                        | Concrete ingestion Handler, Scheduler, projection consumer, health and metrics      |
| `apps/api`                                  | Unified-auth REST/GraphQL composition and safe download redirects                   |
| `apps/mcp` / `skills/wiser-data-foundation` | Agent adapters that use HTTP only                                                   |
| `apps/web`                                  | Bilingual read-only governance workspace driven by a server-only DAL                |

Dependency direction is `platform contracts <- data-contracts <- data-core <- application/infra <- apps`. Core imports no database, HTTP, filesystem, framework, clock, random source, or AI provider. Time, IDs, and effects enter through ports.

## One Capability contract

`@wiser/data-contracts` is the sole source for REST, GraphQL, MCP, Skills, and runtime validation. Public DTOs use strict Zod 4 schemas; unknown and missing fields both fail. `GET /api/data/v1/capabilities` returns draft-7 input/output JSON Schema, scopes, security ceiling, execution mode, timeout, audit level, and exact mappings for all four transports.

The Registry covers catalog/version, query/search, knowledge/graph, geo, upload/ingestion, and Operation lifecycles. Exact Capability IDs, order, versions, scopes, and transport mappings live only in the discovery endpoint and [protocol reference](/en/protocols/data-rest/); this architecture page does not maintain a second list.

Every executor traverses input/output validation, live scopes, the security-level ceiling, purpose, declared timeout, command idempotency, and hash-only audit. Queries accept structured filters only—never arbitrary SQL, Cypher, OpenSearch DSL, shell, or database administration.

The local `data-steward` Role seed grants only the scopes needed by the demonstration. A new Capability changes Registry, role/scope, API, MCP, Skill, docs, and verification together.

## Data model and independent migration history

Data SQL never enters the Supabase migration history. `infrastructure/data-foundation/postgres/migrations` is canonical:

| Migration                                | Content                                                                                   |
| ---------------------------------------- | ----------------------------------------------------------------------------------------- |
| `0001_bootstrap.sql`                     | pgcrypto, PostGIS, btree_gist, unaccent, eight business schemas, migration ledger         |
| `0002_authority_model.sql`               | catalog, asset, ingestion, quality, lineage, knowledge, Operation, security, Outbox model |
| `0003_security_jobs_events.sql`          | RLS, authorization session settings, append-only guards, job/event security               |
| `0004_job_lifecycle.sql`                 | claim/heartbeat/settle/fail/recover/cancel and atomic Operation/Outbox transitions        |
| `0005_content_blob_model.sql`            | separate content and asset identity, backfill, immutable storage references               |
| `0006_content_lifecycle_constraints.sql` | structural `QUARANTINED → FINGERPRINTED → RAW` lifecycle                                  |
| `0007_version_publication_lifecycle.sql` | the sole one-time `UNPUBLISHED → PUBLISHED` change with content fixed                     |
| `0008_governed_gis_tiles.sql`            | one Martin-discoverable governed MVT function with five fixed scope parameters            |

The TS7 runner sorts four-digit versions, runs each file transactionally under one session advisory lock, and records filename plus SHA-256. Missing, renamed, modified, or non-prefix applied history fails closed. pgSTAC uses official pyPgSTAC 0.9.12 migrations rather than pretending to be a PostgreSQL extension.

There are 36 business tables, every one with `ENABLE` and `FORCE ROW LEVEL SECURITY`, plus a separate `schema_migrations` ledger. API and Worker use distinct non-superuser roles created by deployment provisioning; migrations do not grant runtime implicitly. Every transaction sets validated Tenant, Project, maximum security level, and policy version. Missing context returns no rows or fails.

Martin uses an isolated `wiser_data_gis` login: `NOSUPERUSER`, `NOBYPASSRLS`, no generic runtime-role inheritance, no business-table privileges, and execute-only access to `service.wiser_spatial_extent_mvt`. That security-definer function accepts exactly five `tenantId/projectId/versionId/maxSecurityLevel/policyVersion` query values and repeats Version/spatial-extent filtering inside SQL.

API vector tiles RLS-authorize the Version/spatial extent before injecting those five values into the function. Raster tiles select only a visible RAW TIFF/GeoTIFF COG, validate its `tenants/.../versions/{versionId}/sha256/{hash}` content-addressed key, and only then construct the internal S3 URI for TiTiler server-side. Browsers cannot select an object or upstream.

Triggers reject invalid UPDATE/DELETE on Operation, Audit, Outbox, content, and version history. Complex transitions use explicit transactions, row locks or optimistic versions, unique constraints, and append-only facts.

## Authority objects and commit

`DataItem` is the smallest governance unit, not a file, table, or layer. Processing stage, quality grade, acceptance status, publication status, and L0–L3 security level remain separate dimensions.

The SeaweedFS adapter forces path-style S3 and derives every key from validated Tenant/Project/Upload/Version UUIDs and lowercase SHA-256; callers cannot supply arbitrary paths. Upload is an unambiguous `PRESIGNED_PUT` or `MULTIPART` contract. Signed URLs live for 60–900 seconds. Completion HEAD-checks size, content type, and SHA-256 metadata.

Content remains in quarantine first. Fingerprinting establishes `catalog.content_blob`; formal commit idempotently promotes it to content-addressed raw/version keys. An identical hash can be reused, while a different hash is never overwritten. Abort removes only a derived quarantine object. Version-asset reads reauthorize through Supabase and data-postgres RLS, append audit, then return a 60-second `303` signed redirect. STAC manifests never expose long-lived S3 credentials.

MCP Evidence/STAC Resources read through real HTTP authority boundaries. Evidence GET returns only an RLS-visible fragment attached to a committed version and appends `data.evidence.read` hash-only audit. STAC GET first binds collection to the current Tenant/Project, reads bounded data from one fixed internal STAC origin, strips upstream internals, then reconciles published/accepted version, Evidence, source hash, security, policy, and quality in data-postgres before appending `data.stac-item.read`. Both JSON responses are capped at 256 KiB, and a STAC asset can target only the short-lived governed download endpoint above.

Only an approved frozen review checkpoint can create a formal version. One data-postgres transaction commits DataItemVersion, quality/lineage facts, Operation event, Audit, and Outbox. Supabase, data-postgres, and S3 never pretend to share a distributed transaction.

## Deterministic ingestion and Agent boundary

Ingestion has exactly 18 states:

```text
RECEIVED → QUARANTINED → SECURITY_SCANNED → FINGERPRINTED
→ PROFILED → CLASSIFIED → SCHEMA_MAPPED → SEMANTIC_MAPPED
→ VALIDATED → SPATIOTEMPORAL_ALIGNED
→ REVIEW_REQUIRED / APPROVED / REJECTED
→ COMMITTED → PROJECTING → PUBLISHED

Policy may move eligible non-terminal states to FAILED or CANCELLED;
REJECTED, PUBLISHED, FAILED, and CANCELLED are terminal.
```

The default Worker executes ingestion through the concrete `data.ingestion.process.v1` Handler:

1. restore uploads and version from authority;
2. verify size/media type through the S3 reader;
3. scan with ClamAV INSTREAM;
4. stream SHA-256 and persist fingerprints;
5. parse Markdown/documents with Tika and GeoJSON with a controlled parser that retains source CRS;
6. produce deterministic profile/classification;
7. let the fixture fake Agent propose schema/semantic plans, then validate confidence and shape through an injected validator;
8. run deterministic transformation, quality, and EPSG:4326/4490/3857 alignment;
9. freeze a hash-only review checkpoint and route low-confidence/high-risk work to human review;
10. commit authority and Outbox after approval, then publish only after all five completion-target ledgers succeed.

An Agent proposes explanations and plans. It cannot modify source data, silently correct fields, decide quality/acceptance, bypass review, or write authority/projection stores. The fake Agent and `DeterministicFakeEmbedding` are for tests, CI, and local smoke only; identical text, version, and dimension yield identical finite vectors. Worker records Agent run/action, model identity, input/output hashes, and transform plan without putting prompts, credentials, or object bodies in audit.

Quality reads deterministic checks only; one failed blocking rule prevents passage regardless of score. Derived security inherits the highest source level and may only be raised. Publication requires a committed version, eligible acceptance, passing quality, `PROJECTING`, and five unique `SUCCEEDED` targets.

## Durable jobs, Outbox, and projections

Worker uses PostgreSQL `FOR UPDATE SKIP LOCKED`, lease owner/expiry, heartbeat, priority, attempt count, deterministic exponential backoff, cancellation, waiting-input/review, timeout recovery, and dead letter. Native Node HTTP exposes `/health/live`, `/health/ready`, and Prometheus `/metrics`. Graceful shutdown stops claiming and drains in-flight handlers.

`ProjectionOutboxConsumer` reads after a monotonic checkpoint. Per-target `PENDING/RUNNING/SUCCEEDED/FAILED` ledger survives crashes; an external write that completed before ledger update can be retried safely, while a succeeded target is skipped. Projection identity derives from authoritative DataItem/Version/Evidence IDs:

If all five completion targets succeeded but the matching Operation is already `FAILED` or `CANCELLED`, that publication poison event may neither rewrite the terminal Operation nor publish the authoritative version. Consumer writes `PUBLICATION_OPERATION_TERMINAL` to `consumer_checkpoint.last_error` and advances past the event so it cannot block the queue head; a later successful event clears the summary. Original Job, Operation, target ledger, and version evidence remain intact.

- data-postgres/PostGIS `catalog.spatial_extent` retains RLS-protected source geometry, CGCS2000 canonical geometry, and a Web Mercator display derivative; authority rows are not cleared with projection caches;
- Weaviate uses Worker-provided versioned vectors and an authenticated tenant;
- OpenSearch uses a governed ICU index;
- Neo4j uses fixed parameterized `MERGE` facts;
- pgSTAC writes STAC 1.1 Collections/Items whose asset href reaches the governed API download endpoint.

Matching query adapters push down Tenant, Project, Version, security, policy version, acceptance, publication, domain, and channel filters. `SearchOrchestrator` recalls in parallel, applies fixed `RRF k=60`, deduplicates by DataItem+Version, then reauthorizes every hit and redacts excerpts.

## Protocol and product surfaces

- REST: `/api/data/v1` discovery, 22 Capabilities, Operation SSE, Evidence/STAC Resources, authorized asset redirects, and the sole external OGC/STAC/vector/raster GIS proxy. Fastify OpenAPI projects all 22 Capabilities directly from the Zod 4 Registry and documents GIS GETs with explicit safe route Schemas under the shared **WISER Platform API** title; see [Data REST](/en/protocols/data-rest/).
- GraphQL: `POST /graphql`, 22 schema-first fields sharing the same Handler; see [Data GraphQL](/en/protocols/data-graphql/).
- MCP: stdio/stateless Streamable HTTP, 22 Tools and governed Resources that call HTTP only; see [Data MCP](/en/protocols/data-mcp/).
- Skill: `skills/wiser-data-foundation` documents discovery, query, upload, ingestion, Operation, and security workflows.
- Web: 14 Data routes in the existing Next.js app with server-only DAL, real Supabase session, both locales/themes, immutable-version selection, and four MapLibre layers: PostGIS authority GeoJSON, STAC extents, governed vector MVT, and raster.

DataItem detail `?version=<uuid>` sends the requested version to API and verifies `selectedVersion`; version links use `aria-current` and can open the governed map. Map query is `?bbox=minx,miny,maxx,maxy&version=<uuid>&crs=EPSG:4326|EPSG:4490`, with independent layer controls plus pinned Version and `source CRS → EPSG:3857`. The browser calls only same-origin `/api/data-foundation/geo/...`; Next server uses the freshly verified short-lived Supabase Session and adds Tenant/Project/Purpose before forwarding to Fastify. Bearers and internal GIS origins never reach the client.

Web governs and queries; it never performs file parsing, vectorization, GIS transformation, or projection in a Server Action or Route Handler. Its same-origin GIS Route Handler is only a bounded authenticated proxy. Mutations enter through REST, GraphQL, MCP, or the Skill.

## Dependencies and executable verification

Exact npm versions come from the relevant `package.json` files and the root `pnpm-lock.yaml`. Stable Data container tags, digests, and compatibility notes come from `compose.yaml` and `infrastructure/data-foundation/versions.env`. Architecture prose does not duplicate those frequently changing inventories.

`pnpm data:smoke` validates upload, scanning, parsing, controlled Agent planning, deterministic transformation, quality/human gates, authority commit, Outbox, and all projections, then reads the result through REST, GraphQL, MCP, and authenticated Web. Reprocessing the same Outbox event must create no duplicate authority or projection object. See [Testing and verification](/en/development/testing/) for the command matrix and [Databases and migrations](/en/development/databases/) for reset and migration discipline.
