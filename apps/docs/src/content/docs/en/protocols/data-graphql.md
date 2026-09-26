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
lastReviewedAt: 2026-09-26
lastReviewedCommit: 26b4d35fec914ff5391b09f47c7cdee6439f70af
---

## Endpoint and authority contract

Data GraphQL runs in the shared Fastify API:

```text
POST /graphql
Content-Type: application/json
```

It uses Mercurius with schema-first SDL and no decorator or TypeScript AST scanning. GraphQL fields are projections of the 42 Capabilities. Resolvers and REST call the same `DataCapabilityHandler`, preserving Zod input/output validation, scopes, security ceiling, purpose, timeout, idempotency, and audit semantics.

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

| Field                    | Capability                    | Purpose                                           |
| ------------------------ | ----------------------------- | ------------------------------------------------- |
| `externalSourceMetadata` | `data.external.metadata.read` | Bounded authorized external metadata              |
| `dataCatalog`            | `data.catalog.search`         | Cursor catalog connection                         |
| `dataItem`               | `data.catalog.get`            | One DataItem and optional version                 |
| `dataQuery`              | `data.query`                  | Structured field/filter query                     |
| `dataSearch`             | `data.search.federated`       | Multi-backend RRF search                          |
| `knowledgeSearch`        | `data.knowledge.search`       | Evidence/knowledge search                         |
| `graphExpand`            | `data.graph.expand`           | Bounded entity neighborhood                       |
| `graphFindPath`          | `data.graph.findPath`         | Bounded relation path                             |
| `geoQuery`               | `data.geo.query`              | Governed spatial predicate                        |
| `geoIntersect`           | `data.geo.intersect`          | Intersection of two governed geo targets          |
| `dataOperation`          | `data.operation.get`          | One Operation                                     |
| `dataItemVersions`       | `data.catalog.versions.list`  | Version connection                                |
| `dataItemVersion`        | `data.catalog.versions.get`   | Exact immutable version                           |
| `dataIngestion`          | `data.ingestion.get`          | Ingestion plus quality/Agent/projection summaries |
| `dataOperationEvents`    | `data.operation.events`       | Bounded Operation event page as JSON, not SSE     |

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

For `view: "resources"`, the shared JSON response may include `summary.coverage`: `temporal` and `geometry` each partition the reauthorized, pinned `summary.resourceCount` into `recordedVersionCount` and `unknownVersionCount`, regardless of page size. Each version with at least one RLS-visible extent counts once; absent or hidden extent records remain unknown. This does not certify sampling time, geometry precision, CRS, or named place identity. `approvedAssertionCount` and `effectiveActions` are `null` until separately verified. GraphQL does not compute or cache another coverage total; an expired or revoked query cannot reuse the old result.

`data.analysis.create` accepts an existing published `dataItemId` / `versionId` and an idempotency key. It creates an audited operation and a durable analysis job atomically; source registration and its quality declaration remain unchanged. REST: `POST /api/data/v1/analyses`; GraphQL: `createDataAnalysis(input: JSON!)`; MCP: `data_analysis_create`. Required scopes are `data.ingestion.write` and `data.catalog.read`. Poll the returned operation for completion.

Exploration 1.1 pins the completed analysis batch together with each published version. `view: "records"` requires `queryId` and `versionId` and returns per-asset columns, stable record/feature IDs and a bounded page. `view: "map"` reuses the same result set with an optional WGS84 `[west,south,east,north]` bounding box. Cursors are bound to their view and filters. Re-run the specification to include an analysis completed after the original query. Counts describe indexed records, while resource readiness and coverage disclose unparsed sources.

Exploration 1.2 adds `view: "graph"` on the same authorized manifest. Optional `versionId` narrows the resource graph; `recordId` additionally requires that version and a record in its pinned analysis. Typed resource/version/asset/evidence nodes express authoritative containment, with a focused record sharing its table/map identity. Asset nodes retain source hashes. This provenance view does not infer scientific relationships. Pages include at most 100 versions, 200 assets and 100 evidence fragments; `truncated` discloses omitted nodes and `nextCursor` pages remaining versions. Graph cursors cannot be reused across focus changes. Earlier 1.0 and 1.1 schema definitions remain archived.

Exploration 1.3 adds exact provider names, registration kinds, and content/spatial readiness filters to `QuerySpec`. The result summary counts the entire authorized pinned set, separately from the current resource page. Completed analysis with no content assets is `METADATA_ONLY`; parsed empty content is `EMPTY`; parsed content without verified geometry is `NO_SPATIAL_DATA`, while unknown or untransformable source coordinates are `CRS_UNVERIFIED`. Invalid, restricted and unsupported unparsed content retains unknown counts. Physical format companions do not establish analytical availability. Indexed content records include source representations and document/archive records, not deduplicated scientific observations. The 1.0–1.2 schemas remain immutable in the contract archive.

Exploration 1.4 permits `recordId` in `view: "records"`, together with `queryId` and `versionId`, to retrieve one exact record from the pinned analysis. The API resolves its source asset; an explicitly different asset or a record outside the query returns not found. Exact-record lookups cannot use continuation cursors. Existing resource, record-page, map and graph semantics remain version-scoped, and the 1.3 schemas remain archived.

The query-result vector endpoint `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf` additionally requires `data.query.execute` and `data.catalog.read`. Each request reauthorizes the owner-bound manifest and all pinned versions/analyses under RLS before calling Martin. Caller query parameters are forbidden; all seven scope values come from the verified context and path. Responses use the `exploration` source layer and `Cache-Control: no-store`; expired, revoked or foreign result sets cannot reach the upstream. Existing version-based tiles retain their route and layer.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Exploration 1.6 forwards the strict asset-bound `recordQuery` through this same capability: one explicit version, schema-validated typed filters, stable field sorting and column projection. Records, map tiles and focused graph records share its immutable conditions; consult Data REST for bounds and null/numeric semantics.

Exploration 1.7 adds `view: "aggregate"` with an existing `queryId`, `versionId` and `aggregate` source specification. Text groups or positive-width numeric bins combine with count/sum/mean/min/max. Every grouping, value and optional unit field is checked against the pinned source schema; units are partitioned without conversion. The existing record predicates and authorization apply before grouping. Counts reconcile valid, missing and invalid measure values; count includes every matching record. Decimal results remain strings, numeric bins carry an exact upper bound, and the response contains at most 200 groups with full group/record counts and explicit truncation. Null group/unit labels include missing, non-scalar or over-4096-character labels; invalid numeric group values also enter the null bucket. Unknown units remain unspecified. The Web statistics tab supplies the fields form, a chart and exact-value table; selecting a representable group creates shared record conditions. Numeric charts approximate finite decimal values while the table retains exact source arithmetic. The 1.6 discovery schemas remain immutable.

Record pages treat `first` as a maximum and also enforce a conservative 3 MiB response budget. PostgreSQL measures the ordered candidate prefix before returning original content; selected columns are projected before measuring. The cursor advances by the records actually returned, so byte-limited pages neither skip nor duplicate records. Metadata/specification overhead is reserved, and a single record that cannot fit fails explicitly instead of truncating its fields. Record views return geometry presence for identity; complete map geometry remains in the map representation.

Exploration 1.8 adds typed time predicates and sorting, and hour/day/month/year aggregation. Source formats are `iso-offset`, `dmy-local` or `ymd-local`; `utcOffsetMinutes` is an explicit fixed offset from −840 to 840, not an inferred time zone or daylight-saving rule. ISO source values retain their own offset. Naive source times require the configured offset, which also defines calendar buckets. Invalid dates become ungroupable rather than normalized. Boundaries are UTC strings with up to six fractional digits, and ranges use inclusive `gte` plus exclusive `lt`. Source strings remain unchanged. The browser supports calendar lines, complete-bucket brushing and equivalent keyboard range controls; unit series remain separate. All views and MVT use the same conditions. The 1.7 discovery schemas remain immutable.

Exploration 1.9 accepts `baseQueryId` alongside a new `spec`. It reauthorizes the entire owner-scoped base before creating a fresh query, limits matching to its pinned version members and preserves each completed analysis ID (including an unparsed null). Explicit versions cannot expand beyond the base. Expired, inaccessible or revoked bases fail rather than silently refreshing to newer analyses. Web record controls and chart selections use this refinement path; ordinary new searches continue to resolve current authorized versions. The 1.8 discovery schema remains immutable.

Exploration 1.10 adds immutable `spec.spatialBounds` in WGS84 west/south/east/north order. It uses verified geometry intersections across records, aggregates, graph record lookups and query MVT before clustering. Resource and provenance overviews contain matching versions; source-readiness metrics retain their documented indexed-content meaning. The manifest keeps the underlying authorized pins so clearing or changing the area via `baseQueryId` does not refresh analyses or lose the original population. Every pinned member is reauthorized even when outside the current area. The map offers point/line/polygon visibility, a legend, local-font cluster counts and viewport filtering; layer visibility is presentation only and never changes query authorization or counts. Unverified coordinates are excluded explicitly. The 1.9 discovery schemas remain immutable.

Exploration 1.11 adds `graph.detail` (`assets`, `evidence`, `records`) for version-bound neighbor pages; record expansion also requires a source asset. `graph.grain` identifies the unit of `totalCount`. Continuation binds focus, detail and relation filters; records retain shared predicates, pinned analyses and the byte budget. `graph.relations` selects containment/provenance edge types. Optional `graph.path` finds a directed shortest path of at most eight edges within this returned page only, after relation filtering; missing endpoints fail without disclosing outside nodes. No path means no path in this page, not in the complete knowledge base. The 1.10 schemas remain immutable.

Saved exploration views use `data.explore.view.create`, `.list`, `.open` and `.revoke`; `data.explore.export` exports one bounded query representation. They require `data.query.execute` and `data.catalog.read`. Create/revoke are synchronous commands with UUID `Idempotency-Key`, atomic audit and command ledger. A saved view keeps the original QuerySpec, version/analysis pins and typed ViewSpec (view requests, page history, selection IDs, map camera/layers), not copied record content. At most 100 active views are kept per owner and project. Private is the default; explicit project sharing still requires authenticated project scope, purpose/security checks and authorization of every pinned member when opening. Listing returns only the caller's saved configurations. Opening reissues an owner-bound 30-minute query and continuation bindings without resolving newer versions or analyses; expiry of the original query does not expire the saved configuration. Revocation is one-way and owner-only. Export reauthorizes the request and returns original values, provenance and explicit returned/total counts with a coverage unit; a later page or truncated representation is never marked complete. No transport drains all pages into SSR/BFF memory.

Saved-view create 1.1 and open 1.2 add optional typed `presentation`: graph view/form/style, bounded cameras and layout, reading mode/page, calendar step unit, and display-only focus references. The existing JSON view payload stores these controls; no new table, source membership, observation or permission is introduced. Focus can highlight only objects returned by the authorized query. Create 1.0 and open 1.0/1.1 discovery schemas stay archived unchanged; saved rows without presentation remain valid. An opened saved link restores the controls once, respects explicit URL overrides, and preserves deliberate resets to defaults on reload. Arbitrary URLs, scripts and unknown fields are rejected.

Saved-view queries are `dataExploreViews(input: JSON!)`, `dataExploreView(input: JSON!)`, `exportDataExplore(input: JSON!)`; mutations are `createDataExploreView(input: JSON!)`, `revokeDataExploreView(input: JSON!)`. All return JSON and use the existing command idempotency header. They receive the elevated query-complexity weight.

## Observation reconciliation

`createDataReconciliation`, `dataReconciliations`, `dataReconciliation`, `reviewDataReconciliation` project `data.reconciliation.create/list/get/review`. See [copy verification and business deduplication](/en/architecture/data-foundation/#copy-verification-and-business-observation-deduplication) for source pins, normalization, immutable evidence and limits. Reads require `data.query` and `data.catalog.read`; creation additionally requires `data.ingestion.write`, review requires `data.publish` and the creating human identity. Review requires `expectedVersion`; REST also requires matching `If-Match: "v1"`. MCP forwards its expected version as that header. Both commands require a stable UUID idempotency key across identical retries.

`get` takes `batchId`, `first` (default 25, maximum 100), optional `after`, and optional `groupIndex`. Without a group index it pages group summaries; with it, it pages that group's source members. Continue with the returned `nextCursor` without changing the batch/version/group. `list` takes `versionId` and returns at most 100 recent owned batches. Creation freezes `left`, `right` and `plan`; review accepts `decision: "verify" | "reject"` and `note`. Conflicts or incomplete records block verification. Candidate results have null `independentObservationCount`; only a human-verified batch has a count within the declared rules. Agents may propose batches and read deterministic evidence but cannot issue the final review as an Agent identity.

## Intake assessment fields

`createDataAssessment(input: JSON!)`, `dataAssessment(input: JSON!)` and `dataAssessments(input: JSON!)` map to `data.assessment.create/get/list`. The JSON scalar preserves the strict shared schemas, source reauthorization and command idempotency. Reports distinguish saved originals, declared coverage, typed check findings and unverified position; they do not modify publication.

`dataAssessmentOverview(input: JSON!)` maps to `data.assessment.overview`, retaining the exact target, authorization, count grain and paging semantics.

`importDataRelations` and `reviewDataRelation` are JSON-input mutations; `dataRelation` and `dataRelations` are JSON-input queries. All map to the same versioned business-relation capabilities as REST, including exact source hashes, default approved-only lists, human review, optimistic versions and command idempotency. Graph neighborhoods use the source version and optional entity/mapping filter; they never implicitly merge source-local identities.

### Typed knowledge candidates (relations 1.1)

Relations 1.1 adds persons, organizations, documents, claims, events, observations, policies, model runs and places through the existing source-bound workflow. Registered predicates constrain endpoint kinds; each extended relation requires explicit record nature, time role, location role and applicability. Plans, historical reports and simulations cannot be declared sampling observations. Source hashes, immutable versions, pending review and permissions remain unchanged. The 1.0 discovery schemas are retained. This extension now also supports explicit cross-source identity correspondence as described below.

Explicit IDENTITY_MATCH candidates reference existing source entities, preserving versioned identities rather than merging equal labels. Import checks names, kinds and external IDs, refusing reference chains. Lists accept at most sixty-four selected sources and source-scoped entity focus. Every source and referenced endpoint is reauthorized on each read; withdrawal hides related edges and counts. Rebuildable projections retain original endpoint identities. Pending correspondence is not approved knowledge.

List capability 1.3 supports a primary source plus at most 63 related versions (64 total), using the existing request and response fields. The 1.1 twelve-source and 1.2 thirty-two-source discovery schemas remain archived unchanged. Every selected source is authorized before counting or reading; no partial result is returned when any source is denied. Pagination remains at most 100 relations per response. This bounded expansion does not change authority data, review state or projection identities.

List capability 1.4 additionally accepts `queryId` instead of inline source IDs. Create the immutable source manifest through the existing exploration POST capability; GET relation pages then use its short ID. Owner, tenant/project, purpose, policy, security level, expiry and every source are rechecked. Missing or denied members fail the request, never a partial success. An empty authorized manifest returns zero. Inline scope retains the 64-source bound; discovery versions 1.0–1.3 remain unchanged. A query ID expires; use existing saved views to reopen pinned versions. Business conditions are available through exploration 1.12 as described below.

Exploration 1.12 adds optional `businessQuery` to an explicit version manifest. It fixes review status, current/history mode, source-time filters and compact assertion/version pins (at most 2,000). Every read rechecks source authorization and authority versions; a changed or unavailable pin fails the whole scope. Relation pages, bound records, record aggregates and map features use this same scope. Explicit `urn:wiser:record:` identities bind only to records in the pinned analysis with a matching evidence asset. Every date-filtered HTML table row requires original-column selections backed by the selected assertion’s pinned table/row/column evidence, even when only one declared period is currently visible. Caller-supplied month columns and unrestricted whole-row text are rejected; the result omits other periods without altering the original asset or claiming daily observations. Resource inventory/readiness counts still describe source assets, not scoped observations. Saved-view open/export 1.1 retain the new scope, while their 1.0 and exploration 1.11 discovery schemas stay frozen. Saved links are purpose-scoped: create a user-facing view with the authorized web-console purpose, not an unrelated batch-test purpose. Geometry-free records remain unlocated; no location or scientific approval is inferred.

### Pinned cross-source evidence

Cross-source relation evidence optionally pins `source.dataItemId`, `versionId`, `analysisId`, and `recordId`, alongside the original asset hash. The locator is `record:<recordId>`; a non-null excerpt must occur in that parsed record. Import/get/review 1.2 and list 1.5 keep prior schemas archived. Every read and retry reauthorizes the owner and all evidence sources; withdrawn, inaccessible, or mismatched evidence cannot contribute to a relation or its evidence/search readback. Dates remain source-supported candidates, not professional approval.

`dataAssessments` uses assessment list 1.1: optional `assetId` selects an exact original, and `latestPerAsset: true` returns one newest authorized report per file before bounded pagination. Missing or stale declarations are not replaced with older claims; the default still returns history.

### Project business scope (exploration 1.13)

`scope: "project"` with `businessQuery` requests a server-resolved authorized source manifest; callers cannot supply version or assertion pins in this mode. Source versions, analysis versions and assertion UUID/revisions are fixed in the existing owner-scoped snapshot. Responses expose `membership` counts and a short `queryId`, not the assertion list. Counts describe fixed membership before display filters, not independent observations or the current page. Resource pages and relation pages remain bounded. Exceeding server limits fails without truncation; the storage ceiling is not a rendering performance claim.

Saved-view open 1.3 and export 1.2 retain this scope. Refining through `baseQueryId` retains existing members and rechecks every original source/assertion before narrowing; it does not absorb later additions. Changing review status requires a fresh query. Missing, withdrawn or changed pins fail the request rather than returning a partial panorama. Exploration 1.12, saved-view open 1.2 and export 1.1 schemas remain immutable archives; explicit-version queries keep their existing limits. Hidden data and undiscoverable metadata are not included. A separately authorized source catalogue is required for discoverable restricted sources. No new GraphQL, REST or MCP route or authority model is introduced.

### Mixed review query scope (exploration 1.14)

`businessQuery.schemaVersion: 2` with `status: "APPROVED_AND_PENDING"` selects authorized approved and pending assertions together. This is a query selector, never an authority state or review decision. Each returned assertion retains its real status and revision; rejected/correction-required assertions are excluded. Current-revision selection never lets a pending correction hide an approved assertion. Version 1 keeps its existing single-state behavior.

Relation list 1.6 accepts the selector only with a persisted business `queryId` whose status matches. Inline sources and ordinary non-business queries cannot use it. Existing source authorization, immutable membership, pagination, record evidence and withdrawal checks still apply; any changed assertion revision invalidates replay even when its status remains inside the selected set. Saved-open 1.4 and export 1.3 preserve this scope. Prior query 1.13, saved-open 1.3, export 1.2 and relation-list 1.5 discovery schemas are frozen, including their schema hashes. No authority model or database migration is introduced.

## External metadata

`externalSourceMetadata(input: JSON!): JSON!` maps to `data.external.metadata.read` 1.0. Use the discovered strict input schema with source ID and explicit year range. This field bypasses per-request loader memoization, so even identical aliases recheck source permission. It shares REST output projection and sanitized error codes in `extensions.code`, and all responses are no-store. Transport cancellation reaches the readonly executor. Default runtime registration remains disabled until trusted source permission and provider wiring exist; no observations are ingested. The outer GraphQL deadline returns HTTP 504 with `CAPABILITY_TIMEOUT`; an interrupted client request is `REQUEST_CANCELLED` (499 when a response can still be sent). Capability audit distinguishes these outcomes.

## Bounded project relation pages

Relation list 1.7 adds opt-in `pageMode: "BOUNDED_PROJECT"` with `first` up to 500, only for an existing project business `queryId`. The server rechecks snapshot ownership, expiry, current source/evidence authorization and immutable assertion revisions before each page. A complete relation is never truncated. The serialized UTF-8 JSON result (items, total and cursor) is bounded to 1 MiB; oversized single relations fail validation rather than returning an empty continuation. Transport envelopes are outside this result budget.

Requests without this mode retain the 100-item limit and existing behavior. The exact 1.6 discovery schemas remain archived; older capability versions are unchanged. Clients must discover 1.7 support before opting in and otherwise use the legacy path. A fixed project membership is not an authorization cache. This reduces repeated requests without changing the cost or scope of full reauthorization, and makes no performance claim until measured.

## Resource scope adapter boundary

Trusted SQL adapters preserve existing public inputs and legacy transactions while accepting an internal compiled authority scope. Resource restrictions apply before result counts and pagination. Catalog continuation binds the resource fingerprint; changed-scope continuation is INVALID_DATA_CURSOR. Existing fixed exploration manifests still fail with CONFLICT when any pinned member becomes inaccessible, including export without the required intersection. An internal export action cannot be supplied through JSON. The platform runtime now supplies fresh resource authority. End-to-end resource administration acceptance remains pending.

Managed federated/semantic search sends at most 1000 trusted content-version pins to each backend; discovery-only scope returns no content hits. Search cursors include the resource fingerprint. Exact item/version/evidence references are checked against Data PostgreSQL RLS, publication and cross-source evidence visibility before releasing a page; missing authority adapters fail closed.

Managed graph expansion/path queries constrain every node and relationship to the content-version pins, omit the full authority snapshot from Neo4j parameters, and revalidate node/evidence references against Data PostgreSQL before returning the graph. Readable endpoints never substitute for readable relationship evidence. Empty content scope avoids querying the projection.

REST, GraphQL, evidence, STAC and map response delivery resolves authority again after work completes; asset content also rechecks after fetching and before sending bytes. Changes to principal, project, purpose, actions, membership revision or resource scope suppress the response, including a legacy-to-managed transition. A command already committed is not rolled back by response denial; use its existing idempotency/audit workflow for reconciliation. Managed asset routes always proxy bytes and never return a signed storage URL. Each proxied chunk rechecks current authority after its upstream read; changed or unavailable authority cancels the remaining stream. Already delivered bytes cannot be recalled. Legacy redirect URLs retain their existing short TTL; they cannot be revoked individually by these checks.

Managed projects admit the explicit resource-aware capability set. Ingestion, operation status/events, reconciliation and maintenance commands fail with FORBIDDEN before unscoped executors run; their resource-aware workflow remains unfinished. External directory calls require an exact, unexpired external.directory source reference in addition to provider authorization. Legacy projects retain their existing capability gates.
