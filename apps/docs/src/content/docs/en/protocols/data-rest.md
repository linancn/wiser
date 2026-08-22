---
title: Data REST API
description: Data Foundation's 22 Capabilities, OpenAPI, governed Resources, idempotency, SSE, and asset-download protocol.
docType: protocol-reference
scope: data-rest-api
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when implementing or calling the Data Foundation REST API
whenToUpdate:
  - when Capabilities, routes, headers, identity, idempotency, versions, or errors change
checkPaths:
  - packages/data-contracts/src/capability/**
  - apps/api/src/data-foundation/**
  - skills/wiser-data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 8169cc9c274ec3622b9c0ddd8d544eb8afe06f27
---

## Protocol boundary

Data REST lives at `/api/data/v1` in the existing Fastify process; it is not a second service. All 22 business routes call one `DataCapabilityHandler`, which validates input and output with strict Zod 4 schemas from `@wiser/data-contracts`, then enforces live scopes, security level, purpose, timeout, idempotency, and hash-only audit.

MCP, the Skill, and Web's server-side DAL all traverse this HTTP boundary. No caller can submit SQL, Cypher, OpenSearch DSL, shell commands, or arbitrary object-store keys.

## Discovery and health

These non-cacheable reads require no identity:

| Method | Path                                               | Result                                                                             |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/data/v1/health`                              | data-postgres, object-store, Worker readiness; any missing authority returns `503` |
| `GET`  | `/api/data/v1/capabilities`                        | ordered 22-item Registry, draft-7 I/O Schemas, and four mappings                   |
| `GET`  | `/api/data/v1/capabilities/:capabilityId/:version` | one fixed Capability version; unknown version returns `404`                        |

A ready response has this core shape:

```json
{
  "status": "ready",
  "system": "data-foundation",
  "authority": { "database": true, "objectStore": true },
  "worker": true,
  "projections": "rebuildable"
}
```

`projections: rebuildable` means projections are not authorization authority. It never permits omission of Tenant/Project/security filters.

## OpenAPI contract projection

Shared `GET /openapi.json` returns OpenAPI 3.1 with the fixed title **WISER Platform API**, covering Platform, Agent EXCON, and Data Foundation. The 22 Data Capabilities do not maintain another handwritten schema. At route registration, Fastify converts Registry Zod 4 input/output into draft-7 JSON Schema and projects it into path, query, body, and required-header OpenAPI operations.

Every Data operation has the `data-foundation` tag, a stable `operationId`, `bearerAuth`, its successful response Schema, plus `Idempotency-Key` for commands and `If-Match` for versioned commands. Fastify schema compilers serve the OpenAPI projection here; the single runtime behavior gate remains strict Zod input/output validation in the shared `DataCapabilityHandler`. Generated documentation never becomes a second behavior source.

Governed OGC/STAC/vector/raster proxies are not Capability Registry entries, so they use explicit route-specific Fastify OpenAPI Schemas. Identity headers, path/query allowlists, binary/content types, and stable 401/403/404/413/422/502/503 errors appear in the same document. POST/PUT/PATCH/DELETE 405 guards remain hidden rather than pretending to be business operations.

## Identity and context headers

Every non-discovery request carries:

```http
Authorization: Bearer <supabase-jwt-or-wdc1-delegated-credential>
X-Wiser-Tenant-Id: <tenant-uuid>
X-Wiser-Project-Id: <project-uuid>
X-Wiser-Purpose: <bounded-purpose>
Accept: application/json
```

The JWT or delegated credential only proves the entry identity. API re-resolves membership, role, scope, L0–L3 ceiling, and authorization version from the Supabase control plane on every request, then sets that exact context in a short data-postgres RLS transaction. Tenant/Project headers never widen permission by themselves.

Every command additionally requires:

```http
Idempotency-Key: <uuid>
```

These versioned commands also require a strong ETag:

```http
If-Match: "v3"
```

This applies to upload Session completion, ingestion submit/approve/reject, and Operation cancel. The header must equal an `expectedVersion` already present in the body. Successful responses include `ETag: "vN"` when an aggregate version is present. Identity, business, and error responses are all `private, no-store`.

## The 22 Capability routes

| Capability                    | Method and path                                           | Success            |
| ----------------------------- | --------------------------------------------------------- | ------------------ |
| `data.catalog.search`         | `GET /catalog/data-items`                                 | `200`              |
| `data.catalog.get`            | `GET /catalog/data-items/:dataItemId`                     | `200`              |
| `data.query`                  | `POST /query`                                             | `200`              |
| `data.search.federated`       | `POST /search`                                            | `200`              |
| `data.knowledge.search`       | `POST /knowledge/search`                                  | `200`              |
| `data.graph.expand`           | `POST /graph/expand`                                      | `200`              |
| `data.graph.findPath`         | `POST /graph/find-path`                                   | `200`              |
| `data.geo.query`              | `POST /geo/query`                                         | `200`              |
| `data.geo.intersect`          | `POST /geo/intersect`                                     | `200`              |
| `data.ingestion.create`       | `POST /ingestions`                                        | `202`              |
| `data.ingestion.submit`       | `POST /ingestions/:ingestionId/submit`                    | `202`              |
| `data.operation.get`          | `GET /operations/:operationId`                            | `200`              |
| `data.catalog.create`         | `POST /catalog/data-items`                                | `201`              |
| `data.catalog.versions.list`  | `GET /catalog/data-items/:dataItemId/versions`            | `200`              |
| `data.catalog.versions.get`   | `GET /catalog/data-items/:dataItemId/versions/:versionId` | `200`              |
| `data.uploadSession.create`   | `POST /upload-sessions`                                   | `201`              |
| `data.uploadSession.complete` | `POST /upload-sessions/:uploadSessionId/complete`         | `200`              |
| `data.ingestion.get`          | `GET /ingestions/:ingestionId`                            | `200`              |
| `data.ingestion.approve`      | `POST /ingestions/:ingestionId/approve`                   | `202`              |
| `data.ingestion.reject`       | `POST /ingestions/:ingestionId/reject`                    | `200`              |
| `data.operation.cancel`       | `POST /operations/:operationId/cancel`                    | `200`              |
| `data.operation.events`       | `GET /operations/:operationId/events`                     | `200` SSE snapshot |

Paths in the table are relative to `/api/data/v1`. Obtain exact inputs, outputs, scopes, and timeouts from discovery schema; do not substitute stale client types for the runtime contract.

## Cursors, queries, and bounds

Lists use `first` and opaque `after`. GET arrays are comma-separated, for example `qualityGrades=A,B`. API rejects colliding path/query/body fields, prototype keys, unbounded numbers, and invalid arrays. Cursors bind to Tenant/Project, scope/filter, and authorization version and cannot cross contexts.

Structured query accepts only allowlisted fields and operators:

- `data.query`: selected fields and `EQ/NE/GT/GTE/LT/LTE/IN/CONTAINS` filters;
- graph: entity IDs, relation types, and bounded depth;
- geo: supported GeoJSON geometry, explicit CRS, and `INTERSECTS/WITHIN/CONTAINS/NEAREST`;
- federated search: an allowlist of catalog/fulltext/semantic/graph/geo/stac sources.

SearchOrchestrator pushes authorization and publication filters into backends, applies fixed `RRF k=60`, deduplicates by DataItem+Version, and reauthorizes every hit.

## Governed GIS proxy

GeoServer, STAC API, TiTiler, and Martin publish no host ports. Browsers, Agents, and external clients use only these Fastify GET/HEAD surfaces:

| Surface      | Governed route                                                                               |
| ------------ | -------------------------------------------------------------------------------------------- |
| OGC          | `/api/data/v1/geo/ogc/{wms                                                                   | wfs | wcs    | wmts}` |
| STAC         | `/api/data/v1/geo/stac`, `/conformance`, `/search`, `/collections/current[/items[/wiser-…]]` |
| Vector tiles | `/api/data/v1/geo/tiles/vector/versions/{versionId}/{z}/{x}/{y}.pbf`                         |
| Raster tiles | `/api/data/v1/geo/tiles/raster/versions/{versionId}/WebMercatorQuad/{z}/{x}/{y}.{png         | jpg | webp}` |

Every call requires the unified Bearer, Tenant, Project, Purpose, and `data.geo.read`; every other HTTP method returns `405`. OGC accepts only each service's read request/query allowlist. Except for GetCapabilities, callers supply an authorized `versionId`, while API fixes layer/type and Tenant/Project/Version filters. STAC `current` becomes the current Tenant/Project's deterministic collection; a cross-scope collection returns safe `404`.

Vector tiles first verify an RLS-visible Version with a spatial extent, then call Martin's sole `service.wiser_spatial_extent_mvt` source with server-injected Tenant, Project, Version, security ceiling, and policy version. Raster tiles select only a visible TIFF/GeoTIFF COG from authoritative RAW assets, validate its content-addressed key, and generate a constrained `s3://` source server-side for TiTiler. A client-supplied `url`/source fails with `422` before upstream I/O.

All four upstream origins come from startup-validated internal configuration; userinfo/query/fragment, redirects, and dynamic hosts are forbidden. Query, coordinates, TMS, format, and response content type use strict allowlists. Default timeout is 5 seconds, response cap is 8 MiB, and only safe ETag/Last-Modified pass through. Every contextual ALLOWED/DENIED/FAILED request records `data.geo.read`, target, and route hash. An unauthenticated denial emits only a redacted platform log because no actor audit may be fabricated.

MapLibre never embeds the API Bearer in a tile URL. An authenticated browser requests only same-origin `/api/data-foundation/geo/...`; the Next Route Handler revalidates the Supabase Session and forwards to these Fastify routes with a server-only access token and fixed Tenant/Project/Purpose while bounding path, query, content, and response size again. This Web path is not another GIS business implementation.

## Upload and ingestion

Recommended sequence:

1. `POST /upload-sessions` with file name, media type, size, optional SHA-256, and `PRESIGNED_PUT`/`MULTIPART` preference;
2. use only response URLs, headers, opaque upload ids, and contiguous part numbers to upload into quarantine;
3. `POST /upload-sessions/:id/complete` with matching idempotency semantics and `If-Match`, submitting size/hash/ETag;
4. `POST /ingestions` referencing completed asset IDs;
5. `POST /ingestions/:id/submit` to start the durable Worker job;
6. read Operation/SSE; at `WAITING_REVIEW`, a steward with `data.publish` approves or rejects;
7. publication follows five successful projections.

URLs live for 60–900 seconds and callers cannot alter keys. API HEAD-verifies object integrity before completion. Formal raw/version objects are content addressed and never overwritten.

## Operation SSE

`GET /operations/:operationId/events?after=<cursor>&first=<n>` returns a bounded `text/event-stream` snapshot rather than holding an unbounded connection. Every event has stable `id`, `event`, and JSON `data` lines. A response with more data carries `X-Next-Cursor`.

Reconnect with the last confirmed cursor. Never synthesize events from wall time or progress percentages, and do not treat a repeated event as a new transition.

Publication consumer respects terminal Operations. Even after all five projections are `SUCCEEDED`, an already `FAILED`/`CANCELLED` Operation is neither rewritten to success nor allowed to publish the version. Consumer records `PUBLICATION_OPERATION_TERMINAL` on its checkpoint and advances past the poison event; a later successful event clears the summary. Original Operation events, Job, and projection evidence are never overwritten.

## Evidence and STAC Resource reads

These governed GETs are not part of the 22 business Capabilities. They specifically back MCP Resources while still using unified Auth, data-postgres RLS, post-authorization audit, and no-store:

| Path                                                        | Scope                 | Authority and output boundary                                                                                                                                       |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/data/v1/evidence/fragments/:evidenceId`               | `data.knowledge.read` | `evidenceId` is a UUID; returns only caller-visible Evidence attached to a committed version, with locator/hash, optional excerpt, security/policy/version metadata |
| `/api/data/v1/stac/collections/:collectionId/items/:itemId` | `data.geo.read`       | collection is the current Tenant/Project's deterministic `wiser-<32 hex>` and item is `wiser-<48 hex>`; returns only an authority-reconciled STAC 1.1 Item          |

The Evidence transaction applies `security.authorized_row` to both fragment and DataItemVersion, then appends `data.evidence.read` with a reference hash. Hidden and absent use the same `404`. STAC rejects a cross-Tenant/Project collection before fetch, reads from one fixed bounded internal STAC origin, strips upstream links/unknown fields, and reconciles DataItem, Version, Evidence, source hash, security, policy, quality, acceptance, and `PUBLISHED`. Its source asset href must exactly match the governed download route below; a successful read appends `data.stac-item.read` audit.

Both Resource responses are bounded to 256 KiB, `application/json`, and `private, no-store`. Invalid references return `422`, excessive output `413`, an invalid projection contract `502`, and unavailable dependencies `503`. Database details, internal STAC bearer/origin, upstream URLs, and raw errors never appear.

## Authorized asset download

Published STAC source assets use:

```text
GET /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/source
```

The complete identity headers and `data.catalog.read` are still required. Path Tenant/Project must equal the authorized context. API selects one RAW asset in an RLS transaction, appends allowed audit, and returns `303` with:

```http
Location: <60-second-presigned-url>
X-Signed-Url-Expires-At: <rfc3339>
```

Absent and undisclosable resources both use safe `404`. Object-store credentials and internal key-resolution failures never enter the response.

## Example

```bash
curl --fail http://127.0.0.1:3001/api/data/v1/health

curl --fail \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H "X-Wiser-Purpose: data-steward-console" \
  'http://127.0.0.1:3001/api/data/v1/catalog/data-items?first=20&qualityGrades=A,B'
```

Writes additionally need `Content-Type: application/json` and a UUID `Idempotency-Key`. Do not persist a real bearer in logs, shell history, Messages, or Artifacts.

## Errors and safe retry

Data REST uses a flat safe envelope:

```json
{
  "code": "CONFLICT",
  "message": "The resource state or version changed.",
  "traceId": "<32-hex>"
}
```

| HTTP  | Meaning                                                               |
| ----- | --------------------------------------------------------------------- |
| `401` | Missing/invalid bearer or Tenant/Project/Purpose context              |
| `403` | Known identity lacks scope, security ceiling, or resource permission  |
| `404` | Resource absent or its existence cannot be disclosed                  |
| `405` | GIS proxy received a method other than GET/HEAD                       |
| `413` | Governed Resource exceeds the 256 KiB response limit                  |
| `409` | State, version, immutability, or idempotency conflict                 |
| `422` | Strict schema, header, or domain precondition failed                  |
| `502` | Upstream Resource/projection violates its governed contract           |
| `503` | Authority, Worker, or projection dependency unavailable               |
| `500` | Server contract/configuration failure with no internal detail exposed |

After an ambiguous failure, retry only the identical actor, Tenant, Project, Purpose, method, path, body, `Idempotency-Key`, and `If-Match`. The same key/canonical hash returns the original result; a different hash conflicts. Then reconcile with the smallest GET or Operation event query.
