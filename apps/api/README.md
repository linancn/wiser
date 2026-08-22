---
title: WISER HTTP API host guide
docType: component-guide
scope: apps/api
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing or running the shared HTTP API boundary
whenToUpdate:
  - when API modules, routes, authentication, or runtime durability changes
checkPaths:
  - apps/api/**
  - packages/contracts/**
  - packages/core/**
  - packages/excon-scenarios/**
  - packages/data-*/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: dd8c0bb38e4d9d9a14e7c1c67d8b9752d04739a8
---

# WISER API host

This is the shared Fastify composition root for WISER Platform, Agent EXCON, Data Foundation, and future systems. Modules are statically imported as namespaced `WiserApiModule` values; duplicate ids fail before readiness. No transport scans TypeScript AST or bypasses system application/authorization boundaries.

For the complete local runtime, use the repository workflow instead of assembling secrets by hand:

```bash
pnpm stack:full:up
```

For protocol/unit development with local compatibility defaults:

```bash
API_PORT=3001 pnpm --filter @wiser/api dev
```

Non-production defaults to `WISER_AUTH_MODE=off`, `EXCON_V2_MODE=memory`, and `DATA_FOUNDATION_MODE=off` only when the corresponding runtime fields are absent. Production forbids Auth/Data off and forbids the EXCON memory runtime.

## Unified Auth composition

`WISER_AUTH_MODE=supabase` creates one current `supabase-js` `getClaims` client, bounded PostgreSQL control-plane Pool, prefix-routed Supabase JWT/delegated Resolver, and transactional Delegation service. It requires:

```text
SUPABASE_URL
SUPABASE_PUBLISHABLE_KEY
DATABASE_URL
WISER_DELEGATED_CREDENTIAL_HMAC_KEYS
```

Every protected request supplies Bearer, Tenant, Project, and Purpose. The Resolver verifies the Supabase Session or strict `wdc1.<public-key-id>.<secret>` credential, then resolves live membership, roles, scopes, L0–L3 ceiling, and authorization version. A malformed/failed delegated credential is never retried as JWT, and failed JWT authentication never falls back to a local token.

Platform routes include:

- `GET /api/platform/v1/me`, a safe principal/authorization projection;
- create/read/issue/rotate/revoke under `/api/platform/v1/delegations`;
- credential revoke under `/api/platform/v1/credentials/:credentialId:revoke`.

Delegation commands require a Supabase human with `platform.delegation.manage` and a UUID `Idempotency-Key`. Issue/rotate return plaintext once; replay returns `SECRET_NOT_RECOVERABLE`. Audit, Outbox, errors, and metadata never contain plaintext or HMAC.

## Agent EXCON runtime durability

v1 `InMemoryExerciseService` remains the explicit legacy Episode compatibility implementation. Its state does not survive restart and v2 failures never downgrade to v1.

v2 has two deliberate modes:

- `memory`: deterministic protocol tests and isolated local labs only; forbidden in production;
- `postgres`: the full-stack/production mode, configured by `EXCON_JOURNAL_DATABASE_URL` and `EXCON_LEASE_HMAC_KEYS`.

The PostgreSQL mode wraps the deterministic v2 service in an append-only command journal. It records all 19 v2 mutations (`createScenario` through `endorseSubmission`) as immutable intent/outcome rows, including canonical request/result hashes and a deterministic tape of generated UUIDs, timestamps, and lease counters. Lease tokens are never stored in plaintext; journal arguments contain HMAC secret references keyed by a retained rotation key id.

Startup requires a non-superuser role, acquires one PostgreSQL advisory writer lock, loads every intent/outcome in sequence, verifies schema/hash/secret references, replays the generation tape, and compares each result or stable rejection. Corrupt, incomplete, drifted, unknown-key, or concurrently owned journals fail closed. Fastify shutdown releases the writer lock and closes the Pool.

This is durable restart recovery, but it is intentionally a single-writer journal/replay adapter rather than one normalized PostgreSQL repository per v2 aggregate.

### EXCON routes

- `GET /health/live`, `GET /health/ready`, `GET /openapi.json`
- explicit v1 Episode API under `/api/v1`
- public v2 scenario catalog under `/api/v2/scenarios`
- operator Scenario/Agent/Run lifecycle and replay under `/api/v2`
- RunAgent `/sync`, Task leases, Messages, Artifacts, Submissions, endorsements, Feedback, and agent-safe replay under `/api/v2`

The bundled Yongding case pack enters the runtime only through the validated public exports of the private workspace package `@agent-excon/scenarios`; API code never reads or constructs package-internal asset paths.

The participant authenticator uses the same Platform Resolver when unified Auth is active. The injected EXCON Tenant, Project, and Purpose are fixed server context; a Supabase human or delegated Agent must have the right live EXCON roles/scopes and RunAgent binding. Static participant/operator tokens exist only when Auth is explicitly off outside production.

## Data Foundation runtime

`DATA_FOUNDATION_MODE=enabled` requires unified Auth and validates the complete Data runtime configuration at startup. It creates:

- one bounded non-superuser data-postgres API Pool;
- internal and public-endpoint SeaweedFS S3 clients;
- all 22 exact Capability executors (read, command, and specialized query);
- one `DataCapabilityHandler` with hash-only audit;
- readiness probes for database, object store, and Data Worker;
- REST, schema-first GraphQL, governed Evidence/STAC Resource, fixed-origin GIS proxy, and asset-download modules.

Startup fails unless executor ids exactly match the Registry. `onClose` closes the Pool and both S3 clients exactly once.

### Data routes

- `GET /api/data/v1/health`
- `GET /api/data/v1/capabilities`
- `GET /api/data/v1/capabilities/:capabilityId/:version`
- all 22 Registry REST mappings under `/api/data/v1`
- `GET /api/data/v1/evidence/fragments/:evidenceId` for committed, RLS-authorized, audited Evidence projections
- `GET /api/data/v1/stac/collections/:collectionId/items/:itemId` for sanitized, authority-reconciled STAC 1.1 Items
- `GET /api/data/v1/tenants/:tenantId/projects/:projectId/versions/:versionId/assets/source` for audited short-lived `303` redirects
- `GET|HEAD /api/data/v1/geo/ogc/{wms|wfs|wcs|wmts}`
- governed STAC under `/api/data/v1/geo/stac`
- version-pinned vector/raster tiles under `/api/data/v1/geo/tiles/{vector|raster}/versions/...`
- `POST /graphql` with all 22 schema-first fields

REST requires UUID idempotency keys for commands, strong `If-Match: "vN"` for versioned commands, cursor paging, safe ETags, no-store, and bounded Operation SSE snapshots. GraphQL shares the Handler, allows one mutation field, disables batching/subscriptions/GraphiQL, enforces depth/complexity/timeout, and disables introspection in production.

Evidence requires `data.knowledge.read`; STAC requires `data.geo.read`. Both re-resolve the unified context, run short data-postgres RLS transactions, append hash-only audit, cap JSON at 256 KiB, and fail closed. STAC additionally rejects a collection outside the current Tenant/Project before calling one fixed internal STAC origin, strips upstream links/unknown fields, and verifies the returned version, evidence, source hash, security, policy, quality, acceptance, publication, and governed asset href.

Every GIS proxy call requires `data.geo.read`, accepts GET/HEAD only, and maps to a startup-validated fixed internal origin. OGC requests use per-service query/request allowlists and fixed Tenant/Project/Version filters. STAC exposes only the current deterministic collection. Vector tiles require an RLS-authorized spatial Version and inject scope into Martin's single MVT function. Raster tiles select an authorized RAW TIFF/GeoTIFF COG and verify its content-addressed key server-side before giving TiTiler a constrained S3 URI; callers cannot supply a source URL. Response content types, size (8 MiB), timeout (5 seconds), ETag/Last-Modified, and ALLOWED/DENIED/FAILED audit are bounded. GeoServer, STAC API, TiTiler, and Martin have no host-published ports.

## Shared OpenAPI

`GET /openapi.json` is one OpenAPI 3.1 document titled **WISER Platform API**, not an Agent-EXCON-only document. All 22 Data REST operations are generated from the Zod 4 Capability Registry: route registration projects draft-7 input/output Schema into path/query/body/header fields, success responses, stable operation ids, `data-foundation` tags, and `bearerAuth`. Pass-through Fastify compilers avoid a competing validation implementation; `DataCapabilityHandler` remains the sole runtime strict-Zod gate.

The governed GIS proxy also appears in that document through explicit route-specific Fastify Schemas for OGC, STAC, vector MVT, and raster tiles. Those operations document required identity headers, safe path/query fields, binary/content types, and stable public errors. Hidden mutating-method guards still return `405` but do not advertise nonexistent GIS writes.

The API pins `graphql` `16.14.2` with Mercurius `16.10.0` as the latest actually compatible stable line tested under TypeScript 7. GraphQL 17 is outside the supported and validated Mercurius peer/runtime boundary for this delivery. `@types/node` remains `24.13.3` because the repository runtime is Node 24; a newer type major would describe a different runtime rather than a safe dependency upgrade.

Data query adapters accept only structured inputs. PostgreSQL, OpenSearch, Weaviate, Neo4j, PostGIS, and pgSTAC credentials stay server-side. Results are reauthorized against Supabase context and data-postgres RLS before return or asset redirect.

## Deterministic and secret boundaries

- Deterministic EXCON evaluation and Data quality/publication policy never call an LLM.
- AI adapters may propose explanations or plans, but never score, authorize, approve, or publish.
- Tests/CI and the local Data smoke use the fake provider/embedding.
- Never mount `~/.codex/auth.json` into this process or a container.
- Never expose Supabase service-role, database URLs, S3 keys, projection credentials, journal HMAC keys, delegated HMAC keys, or Task lease tokens in a browser, MCP argument, log, or telemetry.

See the bilingual Fumadocs references for [Agent EXCON HTTP](../docs/src/content/docs/en/protocols/http.md), [Data REST](../docs/src/content/docs/en/protocols/data-rest.md), and [Data GraphQL](../docs/src/content/docs/en/protocols/data-graphql.md).
