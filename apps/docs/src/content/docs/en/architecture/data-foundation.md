---
title: Data Foundation domain architecture
description: Data Foundation authority boundaries, public contracts, deterministic domain policies, and complete vertical-slice constraints.
docType: architecture
scope: data-foundation
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing Data Foundation DTOs, Capabilities, state machines, or domain gates
  - when implementing data-postgres, object storage, projections, API, MCP, Worker, or Web
whenToUpdate:
  - when public contracts, transitions, authority, projections, or completion boundaries change
checkPaths:
  - packages/data-*/**
  - apps/data-worker/**
  - apps/api/src/data-foundation/**
  - apps/mcp/src/data-foundation/**
  - apps/web/src/app/*/data-foundation/**
  - infrastructure/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: b2b07c3d5840e6a27613128f0f1d34f05d071cbf
---

## Boundary and implementation status

Data Foundation is a WISER business system peer to Agent EXCON. It owns DataItems, immutable versions, assets, ingestion, quality, lineage, knowledge, search, and GIS facts. It does not own user sessions, Tenants, Projects, Roles, or tokens. Supabase is the unified identity and control plane; independent data-postgres/PostGIS and S3-compatible object storage form the data authority; search, graph, STAC, and GIS services are rebuildable projections.

`@wiser/data-contracts`, `@wiser/data-core`, data-postgres/S3 authority `@wiser/data-infra`, the durable-task runtime in `@wiser/data-worker`, and the complete dependency Compose profile are now delivered: strict DTOs/Capabilities, pure deterministic policies, checksummed SQL migrations, the authoritative schema, content-addressed object adapters, a lease scheduler, health/metrics endpoints, and real pinned services are executable. Projection adapters, concrete ingestion/projection handlers, and transports must still complete the same boundary, so this milestone is not the final delivery.

## One public contract source

`@wiser/data-contracts` is the transport-neutral source for REST, GraphQL, MCP, Skills, and runtime validation. Public objects use `z.strictObject` and reject both unknown fields and missing required fields. Normalized draft-7 JSON Schemas are protected by SHA-256 regressions. Exact tables also lock all four transport mappings for the first 12 Capabilities; AST scanning and transport-specific schemas are forbidden.

The Registry preserves the stable order of its initial 12 Capabilities:

```text
data.catalog.search       data.catalog.get
data.query                data.search.federated
data.knowledge.search     data.graph.expand
data.graph.findPath       data.geo.query
data.geo.intersect        data.ingestion.create
data.ingestion.submit     data.operation.get
```

Ten control-plane Capabilities follow that stable prefix and complete the currently required REST, GraphQL, and MCP operations:

```text
data.catalog.create              data.catalog.versions.list
data.catalog.versions.get        data.uploadSession.create
data.uploadSession.complete      data.ingestion.get
data.ingestion.approve           data.ingestion.reject
data.operation.cancel            data.operation.events
```

The REST mapping for `data.operation.events` explicitly uses SSE. Graph operations remain structured `graph.expand/findPath` inputs rather than arbitrary Cypher, and no query Capability accepts arbitrary SQL or OpenSearch DSL.

The shared Fastify host now has an injectable `data.foundation` module. `/api/data/v1/capabilities` serializes the ordered Registry directly through Zod 4's draft-7 generator, so clients can inspect all four transport mappings without AST scanning. `/api/data/v1/health` reports data-postgres, object-store, and Worker readiness from injected probes and returns 503 whenever any authority dependency is missing. The default process does not yet register concrete probes and therefore cannot claim a ready Data Foundation runtime.

A `DataItem` is the smallest governance unit, not a file, table, or layer. Quality grade, acceptance status, publication status, and security level are four independent dimensions; adapters must never collapse them into one “status.”

The initial Capabilities use nine unique scopes: `data.catalog.read`, `data.query.execute`, `data.search.execute`, `data.knowledge.read`, `data.graph.read`, `data.geo.read`, `data.ingestion.write`, `data.operation.read`, and `data.publish`. The local Supabase `data-steward` role must cover all of them. A new Capability must align its Registry mapping and Role seed/management command in the same Green milestone.

## Deterministic domain policies

Ingestion uses exactly 18 states:

```text
RECEIVED → QUARANTINED → SECURITY_SCANNED → FINGERPRINTED
→ PROFILED → CLASSIFIED → SCHEMA_MAPPED → SEMANTIC_MAPPED
→ VALIDATED → SPATIOTEMPORAL_ALIGNED
→ REVIEW_REQUIRED / APPROVED / REJECTED
→ COMMITTED → PROJECTING → PUBLISHED

Policy may move eligible non-terminal states to FAILED or CANCELLED;
REJECTED, PUBLISHED, FAILED, and CANCELLED are terminal.
```

Deterministic transformation occurs between `SEMANTIC_MAPPED` and `VALIDATED`; it does not invent a nineteenth `TRANSFORMED` state. Illegal transitions throw domain errors with stable codes. Operations have an independent `PENDING/RUNNING/WAITING_INPUT/WAITING_REVIEW/SUCCEEDED/FAILED/CANCELLED` state machine.

The quality gate reads deterministic checks only and calculates a stable positive-weight score. A failed blocking rule prevents passage even when the score meets the threshold. A/B/C is a quality grade, not acceptance. Only `PASSED` and `CONDITIONALLY_PASSED` are publication-eligible.

Derived data inherits the highest security level of every source. A caller may explicitly raise but never lower that inherited level. Publication additionally requires a committed authoritative version, a passing quality gate, eligible acceptance, ingestion at `PROJECTING`, and one unique successful result for every projection.

## Authoritative commit and projections

Only `APPROVED → COMMITTED` creates a formal version. One data-postgres transaction writes the version, Operation event, audit, and Transactional Outbox. Object content is SHA-256 addressed, and the formal manifest references only verified immutable objects. Supabase, data-postgres, and object storage never pretend to share one distributed transaction.

The S3 authority adapter forces a SeaweedFS path-style endpoint and derives `quarantine`, `raw`, and `versions` keys from validated Tenant/Project/Upload/Version UUIDs plus lowercase SHA-256; callers never supply arbitrary paths. Single-PUT, multipart, and download URLs are bounded to 60–900 seconds. HEAD must match both size and `sha256` metadata before commit. An identical destination is reused, while any different stored hash raises an immutable conflict and is never overwritten. Abort deletes only the derived quarantine key, never raw or version objects, and endpoint failures do not expose credentials or raw storage errors.

The first three pure SQL migrations initialize pgcrypto, PostGIS, btree_gist, unaccent, eight business schemas, `schema_migrations`, and 35 authoritative tables. A fourth migration fixes Job claim, heartbeat, settle, fail, recover, cancel, and atomic Operation-event/Outbox writes. pgSTAC remains managed by the official pyPgSTAC migration rather than a fictional `CREATE EXTENSION pgstac`. The TS7 runner sorts four-digit versions, records filename plus SHA-256, takes one session advisory lock, and executes each file in its own transaction. Missing, renamed, modified, or non-prefix applied history fails closed.

All 35 authoritative tables enable and FORCE RLS. A runtime read must set validated Tenant, Project, maximum security level, and policy-version session settings; omitting any setting returns zero rows. Migrations neither create nor grant a runtime role—the deployment layer must explicitly create a least-privilege identity. Database triggers reject UPDATE/DELETE on Operation, Audit, and Outbox events. Durable jobs are claimed with `FOR UPDATE SKIP LOCKED`, lease owner/expiry, attempt count, and priority.

Data Worker uses a static Handler Registry and rejects duplicate job types at startup. Its injected-clock Scheduler recovers timeouts, claims batches, heartbeats, applies deterministic exponential retry, dead-letters, cancels, and enters `WAITING_INPUT/WAITING_REVIEW`; graceful shutdown drains in-flight handlers before closing the database. Native Node HTTP exposes `/health/live`, `/health/ready`, and Prometheus `/metrics` without a second Web framework. The generic runtime is delivered, but the default entrypoint has no concrete business handlers yet and is not a complete ingestion Worker.

The Worker loads canonical `DATA_*` environment names at startup and fails closed on invalid database URLs, UUID scopes, security levels, lease/heartbeat relationships, hosts, and ports. The previous `WISER_DATA_*` names remain temporary, observable compatibility aliases; canonical values always win and aliases are never used as fallback after an invalid canonical value.

## Exactly pinned local dependency profile

The `data-foundation` Compose profile runs an independent PostgreSQL 18.6/PostGIS 3.6 authority database plus pyPgSTAC 0.9.12, SeaweedFS 4.43, Weaviate 1.39.0, OpenSearch/Dashboards 3.8.0, Neo4j 2026.07.1, GeoServer 3.0.1, STAC API 6.3.1, TiTiler 2.2.1, Martin 1.14.0, Tika 3.3.1.0, and ClamAV 1.5.4. Every image is a literal stable tag plus sha256 digest in Compose and is audited again in `infrastructure/data-foundation/versions.env`.

The official OpenSearch image does not contain `analysis-icu`. A one-shot initializer downloads only the 3.8.0 official artifact, verifies SHA-512 before installation, and places it in a read-only named plugin volume. OpenSearch readiness verifies both cluster health and the loaded plugin. All services drop every Linux capability first; only upstream entrypoints that demonstrably initialize a named volume or drop UID/GID receive the required CHOWN/DAC/FOWNER/SETUID/SETGID subset. Ports bind to loopback, credentials are non-default local values, logs rotate, resources are bounded, and no service uses the host network.

PostgreSQL 18/PostGIS and GeoServer are currently official amd64-only images, so Compose declares `linux/amd64` for deterministic Apple Silicon emulation. The migration suite has been executed against that PostgreSQL 18.6 container, and SeaweedFS anonymous S3 access is denied. This compatibility evidence does not eliminate the final full-stack smoke gate.

Workers consume the Outbox and idempotently build PostGIS, Weaviate, OpenSearch, Neo4j, STAC, and GIS projections. Projections push down Tenant, Project, Version, security-level, and policy-version filters, while the API still reauthorizes every read, download, export, and publication against the Supabase authority context.

## Completion gate

Data Foundation initialization is complete only when two fixtures genuinely traverse upload, quarantine, scanning, fingerprinting, parsing, fake-AI mapping, deterministic transformation, quality checks, authoritative commit, Outbox, every projection, and queries through REST, GraphQL, MCP, and the unified Web UI. Fake embeddings must be stable, and replaying one Outbox event must not duplicate versions, objects, nodes, or projections.
