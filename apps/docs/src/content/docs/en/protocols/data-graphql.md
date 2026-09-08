---
title: Data GraphQL API
description: Data Foundation schema-first GraphQL fields, shared Handler, identity, limits, and mutation semantics.
docType: protocol-reference
scope: data-graphql-api
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when implementing or calling the Data Foundation GraphQL API
whenToUpdate:
  - when SDL, resolvers, Capability mappings, identity, limits, or errors change
checkPaths:
  - apps/api/src/data-foundation/schema.graphql
  - apps/api/src/data-foundation/graphql-module.ts
  - packages/data-contracts/src/capability/**
lastReviewedAt: 2026-09-08
lastReviewedCommit: d88b0f5a3a4f451e8bbcb98d06d73a49a96eec58
---

## Endpoint and authority contract

Data GraphQL runs in the shared Fastify API:

```text
POST /graphql
Content-Type: application/json
```

It uses Mercurius with schema-first SDL and no decorator or TypeScript AST scanning. GraphQL fields are projections of the 24 Capabilities. Resolvers and REST call the same `DataCapabilityHandler`, preserving Zod input/output validation, scopes, security ceiling, purpose, timeout, idempotency, and audit semantics.

`apps/api/package.json` and the root lockfile define the exact compatible GraphQL and Mercurius versions, and API typecheck/build verifies that combination. Protocol prose does not duplicate a version inventory that changes during dependency upgrades.

SDL lives in `apps/api/src/data-foundation/schema.graphql`, with regression coverage against the runtime constant. `GET /api/data/v1/capabilities` remains the authoritative discovery source for complete versioned JSON Schemas.

## Identity headers

Every GraphQL request carries:

```http
Authorization: Bearer <supabase-jwt-or-wdc1-delegated-credential>
X-Wiser-Tenant-Id: <tenant-uuid>
X-Wiser-Project-Id: <project-uuid>
X-Wiser-Purpose: <bounded-purpose>
```

API re-resolves Supabase membership, role, and scope and requires Tenant/Project to equal the returned authorization context. An unauthenticated request returns HTTP `401` with `NOT_AUTHENTICATED`; field absence and forbidden access retain each Capability's fail-closed behavior.

Every mutation HTTP request also requires:

```http
Idempotency-Key: <uuid>
```

One request may select only one mutation field, so one key maps to one command. A retry preserves the exact operation name, variables, identity context, and key.

## Query fields

`dataCatalog(filter: { includeTotal: true })` exposes nullable `totalCount` alongside `nodes` and `pageInfo`. This exact nonnegative integer uses GraphQL Float to avoid the 32-bit Int limit and remains bounded by JavaScript safe integer precision. It counts the full authorized filtered catalog, not the current page; omission of the flag leaves the count null.

| Field                 | Capability                   | Purpose                                           |
| --------------------- | ---------------------------- | ------------------------------------------------- |
| `dataCatalog`         | `data.catalog.search`        | Cursor catalog connection                         |
| `dataItem`            | `data.catalog.get`           | One DataItem and optional version                 |
| `dataQuery`           | `data.query`                 | Structured field/filter query                     |
| `dataSearch`          | `data.search.federated`      | Multi-backend RRF search                          |
| `knowledgeSearch`     | `data.knowledge.search`      | Evidence/knowledge search                         |
| `graphExpand`         | `data.graph.expand`          | Bounded entity neighborhood                       |
| `graphFindPath`       | `data.graph.findPath`        | Bounded relation path                             |
| `geoQuery`            | `data.geo.query`             | Governed spatial predicate                        |
| `geoIntersect`        | `data.geo.intersect`         | Intersection of two governed geo targets          |
| `dataOperation`       | `data.operation.get`         | One Operation                                     |
| `dataItemVersions`    | `data.catalog.versions.list` | Version connection                                |
| `dataItemVersion`     | `data.catalog.versions.get`  | Exact immutable version                           |
| `dataIngestion`       | `data.ingestion.get`         | Ingestion plus quality/Agent/projection summaries |
| `dataOperationEvents` | `data.operation.events`      | Bounded Operation event page as JSON, not SSE     |

Connections expose `nodes` and `pageInfo { endCursor hasNextPage }`; other pages retain `nextCursor`. Cursors are opaque and scope-bound. Never copy one from REST, another Tenant/Project, or an old authorization version.

`geoQuery(input: GeoQueryInput!)` accepts one optional `versionId`. When omitted, each bounded response selects extents from every DataItem's latest visible committed version; when supplied, it selects extents from that exact immutable version. Continue with its snapshot/query/scope-bound opaque `nextCursor`. Optional `dataItemIds` intersects either selection. A hidden or absent exact version produces an empty result set rather than disclosing its existence.

`geoIntersect` selects a DataItem target's visible committed Version before collecting every sibling extent; missing, hidden, extent-free, or disjoint targets return the same empty result and never fall back to history. `DataItemVersion.tileAvailability { vector raster }` is required on current catalog outputs and indicates routable governed sources, not GIS upstream health or COG proof.

## Mutation fields

`CreateIngestionInput.sourceRegistration` is an optional JSON projection of the strict ingestion 1.1 descriptor. GraphQL and REST use the same manifest binding, authorization, idempotency, validation and source-registration-only semantics; the JSON scalar does not bypass the Capability schema.

| Field                       | Capability                    | Result                                         |
| --------------------------- | ----------------------------- | ---------------------------------------------- |
| `createDataIngestion`       | `data.ingestion.create`       | Create an asynchronous Operation               |
| `createDataItem`            | `data.catalog.create`         | Create a catalog DataItem                      |
| `createDataUploadSession`   | `data.uploadSession.create`   | Produce a governed upload plan                 |
| `completeDataUploadSession` | `data.uploadSession.complete` | Verify and complete upload                     |
| `submitDataIngestion`       | `data.ingestion.submit`       | Read current version then submit durable work  |
| `approveDataIngestion`      | `data.ingestion.approve`      | Approve with explicit `expectedVersion`        |
| `rejectDataIngestion`       | `data.ingestion.reject`       | Reject with explicit `expectedVersion`         |
| `cancelDataOperation`       | `data.operation.cancel`       | Read current version then request cancellation |

GraphQL never implies “successful request means published.” Long work returns the shared `Operation`; reconcile through `dataOperation` and `dataOperationEvents`. Upload Session URLs are still used directly by the client for PUT/multipart; GraphQL never proxies large object bodies.

## Query example

```bash
curl --fail http://127.0.0.1:3101/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H 'X-Wiser-Purpose: data-steward-console' \
  --data-binary '{
    "query":"query Item($id: ID!, $version: ID) { dataItem(id: $id, version: $version) { dataItemId name securityLevel selectedVersion { versionId version sourceHash } } }",
    "variables":{"id":"00000000-0000-4000-8000-000000000000"}
  }'
```

Real IDs must come from an authorized catalog result. Never place the bearer in query/variables, GraphQL logs, or client cache.

## Mutation example

```bash
curl --fail http://127.0.0.1:3101/graphql \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H 'X-Wiser-Purpose: data-steward-console' \
  -H "Idempotency-Key: $(uuidgen | tr '[:upper:]' '[:lower:]')" \
  --data-binary '{
    "query":"mutation Create($input: CreateIngestionInput!) { createDataIngestion(input: $input) { operationId status progressPercent version } }",
    "variables":{"input":{"assetIds":["00000000-0000-4000-8000-000000000000"],"ownerProjectId":"00000000-0000-4000-8000-000000000000","intendedUses":["catalog"],"requestedSecurityLevel":"L1_INTERNAL"}}
  }'
```

UUIDs in the example are placeholders. Real `assetIds` come from a completed upload Session in the current Project, and `ownerProjectId` must equal the authorized Project.

## Resource and execution limits

Runtime defaults are:

- query depth at most 8;
- complexity at most 500; expensive fields with `first` are weighted up to 100x;
- HTTP query timeout 30 seconds, plus each Capability's Registry timeout;
- no batched queries;
- no subscriptions;
- no more than one mutation field per mutation operation;
- GraphiQL disabled and production introspection disabled;
- query text at most 100,000 characters;
- `private, no-store` responses.

`CapabilityLoader` reuses the same query Promise within one request by `capabilityId + canonical input`. Mercurius loaders batch `DataItem.selectedVersion`. This optimization never caches authorization across identities or requests.

## Field authorization

`DataItem.sourceOrganization` is returned only when live scopes include `data.catalog.sensitive.read`; otherwise it is `null`. Other fields still pass Capability output schema and underlying RLS/redaction. Fragments, aliases, introspection, and error differences cannot be used to infer hidden fields.

Graph, Geo, and Search fields always use structured inputs and parameterized server adapters; there is no general SQL/Cypher/DSL scalar.

## Errors and safe retry

GraphQL validation/execution errors expose a fixed safe message and a stable `extensions.code`. Underlying SQL, object-store/projection bodies, scope lists, and resource existence never appear:

```json
{
  "data": null,
  "errors": [
    {
      "message": "GraphQL request failed.",
      "extensions": { "code": "IDEMPOTENCY_KEY_REQUIRED" }
    }
  ]
}
```

Invalid or oversized requests usually return HTTP `400`; missing identity returns `401`; a field failure after GraphQL execution usually returns HTTP `200` with `errors`. Always inspect both HTTP and the GraphQL envelope.

Queries can retry with the same cursor. A mutation retries only with the same identity, operation, variables, and `Idempotency-Key`; different variables under the same key conflict. Reconcile through `dataOperation` or the smallest resource Query.

## Shared exploration

`dataExplore(input: JSON!): JSON!` invokes `data.explore.query` with the same strict `QuerySpec`, user-bound `queryId`, immutable version membership, expiry and resource envelope as REST. It requires `data.query.execute` and `data.catalog.read`; the field has the same elevated complexity weight as `dataQuery`. Use `{spec:{text:"water"},view:"resources",first:20}` initially, then the returned `queryId` and `nextCursor`.

`data.analysis.create` accepts an existing published `dataItemId` / `versionId` and an idempotency key. It creates an audited operation and a durable analysis job atomically; source registration and its quality declaration remain unchanged. REST: `POST /api/data/v1/analyses`; GraphQL: `createDataAnalysis(input: JSON!)`; MCP: `data_analysis_create`. Required scopes are `data.ingestion.write` and `data.catalog.read`. Poll the returned operation for completion.

Exploration 1.1 pins the completed analysis batch together with each published version. `view: "records"` requires `queryId` and `versionId` and returns per-asset columns, stable record/feature IDs and a bounded page. `view: "map"` reuses the same result set with an optional WGS84 `[west,south,east,north]` bounding box. Cursors are bound to their view and filters. Re-run the specification to include an analysis completed after the original query. Counts describe indexed records, while resource readiness and coverage disclose unparsed sources.

Exploration 1.2 adds `view: "graph"` on the same authorized manifest. Optional `versionId` narrows the resource graph; `recordId` additionally requires that version and a record in its pinned analysis. Typed resource/version/asset/evidence nodes express authoritative containment, with a focused record sharing its table/map identity. Asset nodes retain source hashes. This provenance view does not infer scientific relationships. Pages include at most 100 versions, 200 assets and 100 evidence fragments; `truncated` discloses omitted nodes and `nextCursor` pages remaining versions. Graph cursors cannot be reused across focus changes. Earlier 1.0 and 1.1 schema definitions remain archived.

Exploration 1.3 adds exact provider names, registration kinds, and content/spatial readiness filters to `QuerySpec`. The result summary counts the entire authorized pinned set, separately from the current resource page. Completed analysis with no content assets is `METADATA_ONLY`; parsed empty content is `EMPTY`; parsed content without verified geometry is `NO_SPATIAL_DATA`, while unknown or untransformable source coordinates are `CRS_UNVERIFIED`. Invalid, restricted and unsupported unparsed content retains unknown counts. Physical format companions do not establish analytical availability. Indexed content records include source representations and document/archive records, not deduplicated scientific observations. The 1.0–1.2 schemas remain immutable in the contract archive.

Exploration 1.4 permits `recordId` in `view: "records"`, together with `queryId` and `versionId`, to retrieve one exact record from the pinned analysis. The API resolves its source asset; an explicitly different asset or a record outside the query returns not found. Exact-record lookups cannot use continuation cursors. Existing resource, record-page, map and graph semantics remain version-scoped, and the 1.3 schemas remain archived.

The query-result vector endpoint `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf` additionally requires `data.query.execute` and `data.catalog.read`. Each request reauthorizes the owner-bound manifest and all pinned versions/analyses under RLS before calling Martin. Caller query parameters are forbidden; all seven scope values come from the verified context and path. Responses use the `exploration` source layer and `Cache-Control: no-store`; expired, revoked or foreign result sets cannot reach the upstream. Existing version-based tiles retain their route and layer.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Exploration 1.6 forwards the strict asset-bound `recordQuery` through this same capability: one explicit version, schema-validated typed filters, stable field sorting and column projection. Records, map tiles and focused graph records share its immutable conditions; consult Data REST for bounds and null/numeric semantics.
