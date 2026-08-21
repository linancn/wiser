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
lastReviewedCommit: da0b06a2286bd856bc3948de7b4f7303a62da2cf
---

## Boundary and implementation status

Data Foundation is a WISER business system peer to Agent EXCON. It owns DataItems, immutable versions, assets, ingestion, quality, lineage, knowledge, search, and GIS facts. It does not own user sessions, Tenants, Projects, Roles, or tokens. Supabase is the unified identity and control plane; independent data-postgres/PostGIS and S3-compatible object storage form the data authority; search, graph, STAC, and GIS services are rebuildable projections.

`@wiser/data-contracts` and `@wiser/data-core` are now delivered. The former provides strict Zod 4 DTOs and a static Capability Registry; the latter contains only pure, synchronous, deterministic domain policies. Database, object-store, job, Outbox, projection, and transport layers must still complete the same boundary, so this milestone is not the final delivery.

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

Workers consume the Outbox and idempotently build PostGIS, Weaviate, OpenSearch, Neo4j, STAC, and GIS projections. Projections push down Tenant, Project, Version, security-level, and policy-version filters, while the API still reauthorizes every read, download, export, and publication against the Supabase authority context.

## Completion gate

Data Foundation initialization is complete only when two fixtures genuinely traverse upload, quarantine, scanning, fingerprinting, parsing, fake-AI mapping, deterministic transformation, quality checks, authoritative commit, Outbox, every projection, and queries through REST, GraphQL, MCP, and the unified Web UI. Fake embeddings must be stable, and replaying one Outbox event must not duplicate versions, objects, nodes, or projections.
