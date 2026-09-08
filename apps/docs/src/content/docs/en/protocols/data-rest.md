---
title: Data REST API
description: Data Foundation's 24 Capabilities, OpenAPI, governed Resources, idempotency, SSE, and asset-download protocol.
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
lastReviewedAt: 2026-09-08
lastReviewedCommit: ed4a009b6cd0d97e0c865148549a7405912864c4
---

## Protocol boundary

Data REST lives at `/api/data/v1` in the existing Fastify process; it is not a second service. All 22 business routes call one `DataCapabilityHandler`, which validates input and output with strict Zod 4 schemas from `@wiser/data-contracts`, then enforces live scopes, security level, purpose, timeout, idempotency, and hash-only audit.

MCP, the Skill, and Web's server-side DAL all traverse this HTTP boundary. No caller can submit SQL, Cypher, OpenSearch DSL, shell commands, or arbitrary object-store keys.

## Discovery and health

These non-cacheable reads require no identity:

| Method | Path                                               | Result                                                                             |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET`  | `/api/data/v1/health`                              | data-postgres, object-store, Worker readiness; any missing authority returns `503` |
| `GET`  | `/api/data/v1/capabilities`                        | ordered 24-item Registry, draft-7 I/O Schemas, and four mappings                   |
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

Shared `GET /openapi.json` returns OpenAPI 3.1 with the fixed title **WISER Platform API**, covering Platform, Agent EXCON, and Data Foundation. The 24 Data Capabilities do not maintain another handwritten schema. At route registration, Fastify converts Registry Zod 4 input/output into draft-7 JSON Schema and projects it into path, query, body, and required-header OpenAPI operations.

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

## The 24 Capability routes

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

Catalog search 1.1 accepts `includeTotal=true` and returns optional `totalCount`: the full caller-visible filtered count before pagination. Count and page share one short PostgreSQL repeatable-read transaction and identical RLS context and filters. Later pages are fresh requests, not a cross-request snapshot. Omit the flag when no count is needed; version 1.0 discovery schemas remain immutable in the archive.

Lists use `first` and opaque `after`. GET arrays are comma-separated, for example `qualityGrades=A,B`. API rejects colliding path/query/body fields, prototype keys, unbounded numbers, and invalid arrays. Cursors bind to Tenant/Project, scope/filter, and authorization version and cannot cross contexts.

Structured query accepts only allowlisted fields and operators:

- `data.query`: selected fields and `EQ/NE/GT/GTE/LT/LTE/IN/CONTAINS` filters;
- graph: entity IDs, relation types, and bounded depth;
- `data.geo.query`: supported GeoJSON geometry, explicit CRS, `INTERSECTS/WITHIN/CONTAINS/NEAREST`, and an optional singular `versionId`. Without `versionId`, each bounded response selects extents from every DataItem's latest visible committed version; with it, the response selects extents from that exact immutable version. Continue with the returned snapshot/query/scope-bound opaque `nextCursor`; `dataItemIds` intersects either selection, and a hidden or absent exact version returns an empty result set;
- `data.geo.intersect`: Geometry or DataItem targets. DataItem targets select latest/exact visible committed Version first, collect all sibling extents, and never fall back to an older Version. Missing, hidden, extent-free, or disjoint targets return an indistinguishable empty page; continuation uses the same snapshot/query/scope-bound cursor;
- federated search: an allowlist of catalog/fulltext/semantic/graph/geo/stac sources.

`data.query` reads structured evidence records from the selected committed version. A visible source-registration version without analytical records returns `200` with its exact `versionId`, requested columns and `rows: []`. Use catalog, evidence retrieval and governed asset download to inspect its source materials. Empty results do not imply that raw files were lost. JSON equality and containment filters compare complete extracted JSON operands; real PostgreSQL integration covers all eight operators, empty records and security/policy filtering.

Current catalog get/version responses require `tileAvailability: { vector, raster }`. The flags describe a routable governed source, not GIS service health: vector requires a visible version-level extent; raster requires a visible RAW TIFF/GeoTIFF asset with blob/hash/input linkage and an exact content-addressed key.

SearchOrchestrator pushes authorization and publication filters into backends, applies fixed `RRF k=60`, deduplicates by DataItem+Version, and reauthorizes every hit.

Graph expansion includes a visible isolated seed. A valid graph query with no visible match returns an empty `nodes`/`edges` result, not a dependency failure. The adapter merges all bounded path rows by entity/edge identity, rejects conflicting duplicates, and filters both nodes and relationships by tenant, project, security, policy, acceptance and publication. This does not create relationships absent from the projection.

## Governed GIS proxy

GeoServer, STAC API, TiTiler, and Martin publish no host ports. Browsers, Agents, and external clients use only these Fastify GET/HEAD surfaces:

| Surface      | Governed route                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------- |
| OGC          | `/api/data/v1/geo/ogc/{wms,wfs,wcs,wmts}`                                                       |
| STAC         | `/api/data/v1/geo/stac`, `/conformance`, `/search`, `/collections/current[/items[/wiser-…]]`    |
| Vector tiles | `/api/data/v1/geo/tiles/vector/versions/{versionId}/{z}/{x}/{y}.pbf`                            |
| Raster tiles | `/api/data/v1/geo/tiles/raster/versions/{versionId}/WebMercatorQuad/{z}/{x}/{y}.{png,jpg,webp}` |

Every call requires the unified Bearer, Tenant, Project, Purpose, and `data.geo.read`; every other HTTP method returns `405`. OGC accepts only each service's read request/query allowlist. Except for GetCapabilities, callers supply an authorized `versionId`, while API fixes layer/type and Tenant/Project/Version filters. STAC `current` becomes the current Tenant/Project's deterministic collection; a cross-scope collection returns safe `404`.

Vector tiles first verify an RLS-visible Version with a spatial extent, then call Martin's version-scoped `service.wiser_spatial_extent_mvt` source with server-injected Tenant, Project, Version, security ceiling, and policy version. Raster tiles select only a visible TIFF/GeoTIFF COG from authoritative RAW assets, validate its content-addressed key, and generate a constrained `s3://` source server-side for TiTiler. A client-supplied `url`/source fails with `422` before upstream I/O.

All four upstream origins come from startup-validated internal configuration; userinfo/query/fragment, redirects, and dynamic hosts are forbidden. Query, coordinates, TMS, format, and response content type use strict allowlists. Default timeout is 5 seconds, response cap is 8 MiB, and only safe ETag/Last-Modified pass through. Every contextual ALLOWED/DENIED/FAILED request records `data.geo.read`, target, and route hash. An unauthenticated denial emits only a redacted platform log because no actor audit may be fabricated.

MapLibre never embeds the API Bearer in a tile URL. An authenticated browser requests only same-origin `/api/data-foundation/geo/...`; the Next Route Handler revalidates the Supabase Session and forwards to these Fastify routes with a server-only access token and fixed Tenant/Project/Purpose while bounding path, query, content, and response size again. This Web path is not another GIS business implementation.

## Upload and ingestion

`data.ingestion.create` 1.1 accepts optional `sourceRegistration`; ingestion get/reject 1.1 preserve that descriptor. Their 1.0 schemas remain in the immutable discovery archive. Obtain the full strict schema from discovery. The descriptor contains source/bundle identity, kind, name, provider, access state, explicit completeness, limitations, and `manifestAssetId` / `manifestSha256`. The manifest asset must be among the completed upload assets supplied to ingestion.

The manifest uses `wiser.source-registration.v1`, a matching `sourceId`, a source `record`, and `files`. Each nonempty file binds an `assetId` to original/prepared size and SHA-256, relative path, artifact class, completeness, disposition and related source IDs. Empty inputs require zero sizes and the empty-content hash. Manifests are limited to 512 KiB and 1,000 file entries. Registration publication preserves raw files and declared source metadata; it does not establish analytical usability. The immutable Version and all retrieval limitations retain this distinction.

Recommended sequence:

1. `POST /upload-sessions` with file name, media type, size, optional SHA-256, and `PRESIGNED_PUT`/`MULTIPART` preference;
2. use only response URLs, headers, opaque upload ids, and contiguous part numbers to upload into quarantine;
3. `POST /upload-sessions/:id/complete` with matching idempotency semantics and `If-Match`, submitting size/hash/ETag;
4. `POST /ingestions` referencing completed asset IDs;
5. `POST /ingestions/:id/submit` to start the durable Worker job;
6. read Operation/SSE; at `WAITING_REVIEW`, a steward with `data.publish` approves or rejects;
7. publication follows five successful completion-target ledgers.

URLs live for 60–900 seconds and callers cannot alter keys. API HEAD-verifies object integrity before completion. Formal raw/version objects are content addressed and never overwritten.

## Operation SSE

`GET /operations/:operationId/events?after=<cursor>&first=<n>` returns a bounded `text/event-stream` snapshot rather than holding an unbounded connection. Every event has stable `id`, `event`, and JSON `data` lines. A response with more data carries `X-Next-Cursor`.

Reconnect with the last confirmed cursor. Never synthesize events from wall time or progress percentages, and do not treat a repeated event as a new transition.

Publication consumer respects terminal Operations. Even after all five completion targets are `SUCCEEDED`, an already `FAILED`/`CANCELLED` Operation is neither rewritten to success nor allowed to publish the version. Consumer records `PUBLICATION_OPERATION_TERMINAL` on its checkpoint and advances past the poison event; a later successful event clears the summary. Original Operation events, Job, and target evidence are never overwritten.

## Evidence and STAC Resource reads

These governed GETs are not part of the 24 business Capabilities. They specifically back MCP Resources while still using unified Auth, data-postgres RLS, post-authorization audit, and no-store:

| Path                                                        | Scope                 | Authority and output boundary                                                                                                                                       |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/data/v1/evidence/fragments/:evidenceId`               | `data.knowledge.read` | `evidenceId` is a UUID; returns only caller-visible Evidence attached to a committed version, with locator/hash, optional excerpt, security/policy/version metadata |
| `/api/data/v1/stac/collections/:collectionId/items/:itemId` | `data.geo.read`       | collection is the current Tenant/Project's deterministic `wiser-<32 hex>` and item is `wiser-<48 hex>`; returns only an authority-reconciled STAC 1.1 Item          |

The Evidence transaction applies `security.authorized_row` to both fragment and DataItemVersion, then appends `data.evidence.read` with a reference hash. Hidden and absent use the same `404`. STAC rejects a cross-Tenant/Project collection before fetch, reads from one fixed bounded internal STAC origin, strips upstream links/unknown fields, and reconciles DataItem, Version, Evidence, source hash, security, policy, quality, acceptance, and `PUBLISHED`. Its source asset href must exactly match the governed download route below; a successful read appends `data.stac-item.read` audit.

Both Resource responses are bounded to 256 KiB, `application/json`, and `private, no-store`. Invalid references return `422`, excessive output `413`, an invalid projection contract `502`, and unavailable dependencies `503`. Database details, internal STAC bearer/origin, upstream URLs, and raw errors never appear.

## Authorized asset download

For a multi-file Version, replace the final `source` segment below with an exact `assetId` returned by the Version. The API binds that asset to the requested visible Version and repeats RLS for both. Tenant/Project path values must match the authenticated header context before any lookup or signing. `source` remains the compatibility alias for the first ordered asset; a hidden or unrelated asset returns `404`.

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
curl --fail http://127.0.0.1:3101/api/data/v1/health

curl --fail \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H "X-Wiser-Purpose: data-steward-console" \
  'http://127.0.0.1:3101/api/data/v1/catalog/data-items?first=20&qualityGrades=A,B'
```

Writes additionally need `Content-Type: application/json` and a UUID `Idempotency-Key`. Do not persist a real bearer in logs, shell history, Messages, or Artifacts.

## Errors and safe retry

Data REST uses a flat safe envelope:

```json
{
  "code": "CONFLICT",
  "message": "资源状态或版本已发生变化。 / The resource state or version has changed.",
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

## Shared exploration result sets

`POST /api/data/v1/explore/query` calls `data.explore.query` and requires both `data.query.execute` and `data.catalog.read`. Start with `{"spec":{"text":"water"},"view":"resources","first":20}`. Continue with `{"queryId":"<returned UUID>","view":"resources","first":20,"after":"<returned cursor>"}`. Supply exactly one of `spec` or `queryId`; continuation requires the latter. The response carries `queryId`, `spec`, creation/expiry times, authorized `totalCount`, versioned `resources`, readiness and optional `nextCursor`.

Manifests expire after 30 minutes. Foreign owners, changed Purpose/security/policy and expired IDs return `404`; changed authority membership returns `409`; malformed criteria/cursors and more than 10,000 matching versions return `422`. At most 32 recent manifests are retained per matching owner/context; creating another can evict an older query. Re-run the original specification when a result set expires. Projection readiness may advance independently. No raw SQL, Cypher, tenant or actor override is accepted.

`data.analysis.create` accepts an existing published `dataItemId` / `versionId` and an idempotency key. It creates an audited operation and a durable analysis job atomically; source registration and its quality declaration remain unchanged. REST: `POST /api/data/v1/analyses`; GraphQL: `createDataAnalysis(input: JSON!)`; MCP: `data_analysis_create`. Required scopes are `data.ingestion.write` and `data.catalog.read`. Poll the returned operation for completion.

Exploration 1.1 pins the completed analysis batch together with each published version. `view: "records"` requires `queryId` and `versionId` and returns per-asset columns, stable record/feature IDs and a bounded page. `view: "map"` reuses the same result set with an optional WGS84 `[west,south,east,north]` bounding box. Cursors are bound to their view and filters. Re-run the specification to include an analysis completed after the original query. Counts describe indexed records, while resource readiness and coverage disclose unparsed sources.

Exploration 1.2 adds `view: "graph"` on the same authorized manifest. Optional `versionId` narrows the resource graph; `recordId` additionally requires that version and a record in its pinned analysis. Typed resource/version/asset/evidence nodes express authoritative containment, with a focused record sharing its table/map identity. Asset nodes retain source hashes. This provenance view does not infer scientific relationships. Pages include at most 100 versions, 200 assets and 100 evidence fragments; `truncated` discloses omitted nodes and `nextCursor` pages remaining versions. Graph cursors cannot be reused across focus changes. Earlier 1.0 and 1.1 schema definitions remain archived.

Exploration 1.3 adds exact provider names, registration kinds, and content/spatial readiness filters to `QuerySpec`. The result summary counts the entire authorized pinned set, separately from the current resource page. Completed analysis with no content assets is `METADATA_ONLY`; parsed empty content is `EMPTY`; parsed content without verified geometry is `NO_SPATIAL_DATA`, while unknown or untransformable source coordinates are `CRS_UNVERIFIED`. Invalid, restricted and unsupported unparsed content retains unknown counts. Physical format companions do not establish analytical availability. Indexed content records include source representations and document/archive records, not deduplicated scientific observations. The 1.0–1.2 schemas remain immutable in the contract archive.

Exploration 1.4 permits `recordId` in `view: "records"`, together with `queryId` and `versionId`, to retrieve one exact record from the pinned analysis. The API resolves its source asset; an explicitly different asset or a record outside the query returns not found. Exact-record lookups cannot use continuation cursors. Existing resource, record-page, map and graph semantics remain version-scoped, and the 1.3 schemas remain archived.

The query-result vector endpoint `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf` additionally requires `data.query.execute` and `data.catalog.read`. Each request reauthorizes the owner-bound manifest and all pinned versions/analyses under RLS before calling Martin. Caller query parameters are forbidden; all seven scope values come from the verified context and path. Responses use the `exploration` source layer and `Cache-Control: no-store`; expired, revoked or foreign result sets cannot reach the upstream. Existing version-based tiles retain their route and layer.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

An authorized Martin `204 No Content` response is normalized to an empty `200` MVT response so empty viewports remain usable. This applies only after authorization and only to Martin; other missing content types still fail validation.
