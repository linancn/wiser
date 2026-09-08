---
title: Data MCP integration
description: Invoke 24 Data Capabilities and five governed Resources through the shared WISER MCP Gateway.
docType: protocol-reference
scope: data-mcp-adapter
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when querying or ingesting Data Foundation through MCP
  - when changing Data MCP Tools, Resources, HTTP mappings, or transport
whenToUpdate:
  - when Tools, Resources, credentials, response limits, or API mappings change
checkPaths:
  - apps/mcp/src/data-foundation/**
  - apps/api/src/data-foundation/**
  - packages/data-contracts/src/capability/**
  - skills/wiser-data-foundation/**
lastReviewedAt: 2026-09-08
lastReviewedCommit: d88b0f5a3a4f451e8bbcb98d06d73a49a96eec58
---

## HTTP adapter only

Data MCP is a static `WiserMcpModule` in the existing WISER MCP Gateway, not another business implementation. Both stdio and stateless Streamable HTTP call `/api/data/v1`; they never connect to data-postgres, SeaweedFS, or a projection and never hold a Supabase service-role key.

The module registers 22 strict Zod Tools from the ordered `@wiser/data-contracts` Registry. Tool names, input schemas, query/command annotations, and REST mappings come from the same Capability definitions at runtime. There is no AST scanning, general SQL/Cypher/DSL Tool, or discovered database command.

## Data API configuration

All five values appear together. With none present, Gateway starts only Agent EXCON MCP; partial configuration fails closed:

```bash
export DATA_API_URL=http://127.0.0.1:3101/api/data/v1/
export DATA_API_BEARER_TOKEN=<supabase-jwt-or-wdc1-delegated-credential>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console
```

`DATA_API_URL` must be HTTP(S), have no userinfo/query/fragment, and end in `/api/data/v1/`. Bearer length is 16–8192 characters with no control characters. Tenant/Project are UUIDs, and Purpose is a bounded safe identifier.

The shared Gateway process initializes its Agent EXCON HTTP client first. Even when a caller uses only Data Tools, the current standalone process therefore needs non-empty EXCON configuration consistent with its protocol version:

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v2
export AGENT_EXCON_API_URL=http://127.0.0.1:3101/api/v2/
export AGENT_EXCON_API_KEY=<configured-excon-key>
```

Data Tools never send `AGENT_EXCON_API_KEY`, so a Data-only local process may use a placeholder. Before invoking `excon_*`, replace it with a real credential bound to one RunAgent. It cannot substitute for `DATA_API_BEARER_TOKEN`, or vice versa.

| Verification layer | Credential                                          | Sole responsibility                             |
| ------------------ | --------------------------------------------------- | ----------------------------------------------- |
| MCP HTTP transport | `DATA_MCP_BEARER_TOKEN`                             | Permit `POST /mcp`                              |
| Agent EXCON module | `AGENT_EXCON_API_KEY`                               | Bind `excon_*` downstream calls to one RunAgent |
| Data module        | `DATA_API_BEARER_TOKEN` plus Tenant/Project/Purpose | Authorize `data_*` downstream context           |

One Gateway request can discover both modules, but neither the transport principal nor one system principal gains the other system's permissions.

Local stdio:

```bash
pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

One Gateway registers EXCON and Data modules together. Their API bearers and identity bindings remain separate.

## Streamable HTTP

Compose exposes the stateless endpoint at `http://127.0.0.1:13004/mcp`. For a standalone start, keep the EXCON/Data API configuration above and add:

```bash
export DATA_MCP_BEARER_TOKEN=<random-secret-at-least-16-characters>
export DATA_MCP_HOST=127.0.0.1
export DATA_MCP_PORT=3004

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start:http
```

The two credentials have different jobs:

1. `DATA_MCP_BEARER_TOKEN` protects `POST /mcp` with a timing-safe digest comparison;
2. `DATA_API_BEARER_TOKEN` is the unified WISER identity for downstream REST requests.

Never place either token in a query, Tool argument, Resource URI, log, telemetry, or Git. `GET /health/live` and `/health/ready` are unauthenticated and non-cacheable. Graceful shutdown makes readiness false before draining requests. Every `/mcp` request gets a fresh server/transport; the boundary does not issue or resume MCP sessions.

## The 24 Tools

| MCP Tool                       | Capability                    | Kind    |
| ------------------------------ | ----------------------------- | ------- |
| `data_catalog_search`          | `data.catalog.search`         | query   |
| `data_catalog_get`             | `data.catalog.get`            | query   |
| `data_query`                   | `data.query`                  | query   |
| `data_search_federated`        | `data.search.federated`       | query   |
| `data_knowledge_search`        | `data.knowledge.search`       | query   |
| `data_graph_expand`            | `data.graph.expand`           | query   |
| `data_graph_find_path`         | `data.graph.findPath`         | query   |
| `data_geo_query`               | `data.geo.query`              | query   |
| `data_geo_intersect`           | `data.geo.intersect`          | query   |
| `data_ingestion_create`        | `data.ingestion.create`       | command |
| `data_ingestion_submit`        | `data.ingestion.submit`       | command |
| `data_operation_get`           | `data.operation.get`          | query   |
| `data_catalog_create`          | `data.catalog.create`         | command |
| `data_catalog_versions_list`   | `data.catalog.versions.list`  | query   |
| `data_catalog_version_get`     | `data.catalog.versions.get`   | query   |
| `data_upload_session_create`   | `data.uploadSession.create`   | command |
| `data_upload_session_complete` | `data.uploadSession.complete` | command |
| `data_ingestion_get`           | `data.ingestion.get`          | query   |
| `data_ingestion_approve`       | `data.ingestion.approve`      | command |
| `data_ingestion_reject`        | `data.ingestion.reject`       | command |
| `data_operation_cancel`        | `data.operation.cancel`       | command |
| `data_operation_events`        | `data.operation.events`       | query   |

Queries use `readOnlyHint=true`. Commands are explicitly non-read-only, idempotent, non-destructive, open-world operations. Every command extends its Capability schema with UUID `idempotencyKey`. A versioned command also carries `expectedVersion`; the adapter emits strong `If-Match: "vN"` instead of mixing the transport field into JSON body.

GET Tools encode only boolean, number, string, or string-array queries, and URL-encode each path segment. Other values fail before HTTP. SSE Operation events become bounded `{ items, nextCursor? }` JSON for Agent clients that cannot consume raw SSE.

## Recommended workflows

### Query

`data_catalog_search` accepts `includeTotal: true` for an exact authorized filtered `totalCount`, independent of `first` and the page cursor. Use it for coverage and result summaries instead of counting one page or draining all pages. Discovery retains the immutable 1.0 schema and advertises 1.1.

1. use `data_catalog_search` to obtain authorized DataItems and a cursor;
2. pin immutable `versionId` through `data_catalog_get` or `data_catalog_version_get`;
3. for an exact or historical map, pass that singular `versionId` to `data_geo_query`; otherwise select `data_query`, `data_search_federated`, `data_knowledge_search`, graph, or geo Tools as required;
4. inspect each result's `versionId`, `evidenceId`, security, quality, acceptance, and limitations;
5. never treat a search score as quality or authorization.

`data_geo_query` accepts one optional `versionId`. Omitting it selects extents from each DataItem's latest visible committed version; supplying it selects extents from that exact immutable version. Each response remains bounded by `first` and continues with a snapshot/query/scope-bound opaque `nextCursor`; `dataItemIds` intersects either selection, and a hidden or absent exact version returns an empty result set.

`data_geo_intersect` resolves DataItem targets to a visible committed Version before collecting all sibling extents and never falls back to an older Version. Current catalog/version Tool outputs require `tileAvailability`; Agents may use its booleans to decide whether to offer governed vector/raster routes, but must not infer upstream service health or COG conformance.

### Ingestion

`data_ingestion_create` discovers the optional `sourceRegistration` 1.1 input from the shared Registry. Use it to register real provider/catalog/interface records and raw research assets with an exact source manifest. Preserve sample, partial, empty and unknown states; successful registration does not assert analytical completeness. The Skill's `references/water-bundle.md` defines local inventory and preparation. Native OAuth MCP mode is documented in Backend development; the static configuration above remains the compatibility mode.

1. `data_upload_session_create` produces a quarantine upload plan;
2. the caller uploads large bodies outside MCP through the governed signed URLs;
3. `data_upload_session_complete` verifies objects;
4. call `data_ingestion_create`, then `data_ingestion_submit`;
5. poll `data_operation_get` or `data_operation_events`;
6. only a steward with `data.publish` approves/rejects at `WAITING_REVIEW`;
7. query a fixed version only after `SUCCEEDED`/`PUBLISHED`.

Long-running Tools return the shared `operationId`; they do not hold one MCP request through ingestion and projection. Gateway derives the same `operation://` URI from either a top-level id or nested `operation.operationId` and places it at top-level `structuredContent.resource` for recovery across Tools and Resources.

## Resources

Gateway registers five templates. Every read reauthorizes through the same Data API bearer, Tenant, Project, and Purpose:

| URI template                                       | Content                                       |
| -------------------------------------------------- | --------------------------------------------- |
| `data://items/{dataItemId}/versions/{versionId}`   | Exact immutable DataItemVersion               |
| `evidence://fragments/{evidenceId}`                | Authorized evidence fragment                  |
| `operation://{operationId}`                        | Current Operation state                       |
| `schema://capabilities/{capabilityId}/{version}`   | Fixed Capability schema/mapping               |
| `stac://collections/{collectionId}/items/{itemId}` | Authorized STAC Item with governed asset href |

The Capability registry lists the current version of every operation. A versioned `schema://` Resource is an immutable archive: publishing a compatible newer schema does not remove or rewrite an older URI.

URI segments accept only safe alphanumerics plus `._:-`; slash, traversal, query, and credentials are forbidden. Evidence and STAC Resources use real `/evidence/fragments/:evidenceId` and `/stac/collections/:collectionId/items/:itemId` GETs that reapply scopes, RLS, authority reconciliation, and audit; STAC assets point only to the short-lived governed download route. Resources return `application/json`. Invalid references or downstream unavailability use safe error objects and never echo internal HTTP/database bodies.

## Responses and limits

A success returns both:

- Chinese-first `content` with compact `MACHINE_DATA`;
- identical machine-readable `structuredContent = { ok: true, data, resource? }`; when a valid Operation id exists, `resource` is exactly `operation://<uuid>`.

A complete MCP result over 32,000 characters returns `MCP_RESPONSE_TOO_LARGE`; it is never truncated and presented as complete fact. Reduce `first`, filters, or cursor scope. Downstream HTTP bodies are bounded to 1 MiB, one SSE snapshot to 10,000 events, and every request has a timeout.

The adapter never forwards Data API internal `details`, Bearers, or backend bodies. Tool calls preserve two safely actionable identity semantics:

| Downstream HTTP | `structuredContent.error.code` | Safe recovery action                                                                        |
| --------------- | ------------------------------ | ------------------------------------------------------------------------------------------- |
| `401`           | `NOT_AUTHENTICATED`            | Refresh or reconfigure the short-lived Data API credential                                  |
| `403`           | `NOT_AUTHORIZED`               | Reconcile Tenant, Project, Purpose, scopes, and security level; retries cannot widen access |

Other network, 5xx, contract, and unclassified failures converge to secret-safe `DATA_API_ERROR`:

```json
{
  "ok": false,
  "error": {
    "code": "DATA_API_ERROR",
    "message": "数据基座 API 暂时无法完成请求。 / The Data Foundation API could not complete the request.",
    "action": "核对身份、范围与 Operation 状态后安全重试。 / Reconcile identity, scope, and Operation status before a safe retry."
  }
}
```

This distinction preserves only the identity class; it never forwards API `details`, resource existence, or internal scope lists. MCP Resource reads still converge downstream failures to safe `DATA_RESOURCE_UNAVAILABLE` so the Resource error surface cannot reveal hidden content.

## Safe retry

Retry a Query with the same cursor and filters. Retry a command only with identical principal, Tenant, Project, Purpose, Tool, arguments, and `idempotencyKey`; a versioned command preserves `expectedVersion`. After an ambiguous failure, reconcile with `data_operation_get` or the smallest catalog/ingestion GET instead of blindly generating a new key.

MCP does not persist bearers, upload ids, multipart ETags, or Operation cursors for the caller. Keep that state in a protected, recoverable location outside Agent-visible content.

## Shared exploration

`data_explore_query` invokes `data.explore.query` through `POST /api/data/v1/explore/query`. Start with `{"spec":{"text":"water"},"view":"resources","first":20}`; continue with the returned `queryId` and `nextCursor` in `after`. The API pins published versions for up to 30 minutes and reauthorizes the owner/context on every request. The MCP gateway has no result-set database access. `NOT_PARSED` and null analytical counts are registration readiness, not evidence of zero observations.

`data.analysis.create` accepts an existing published `dataItemId` / `versionId` and an idempotency key. It creates an audited operation and a durable analysis job atomically; source registration and its quality declaration remain unchanged. REST: `POST /api/data/v1/analyses`; GraphQL: `createDataAnalysis(input: JSON!)`; MCP: `data_analysis_create`. Required scopes are `data.ingestion.write` and `data.catalog.read`. Poll the returned operation for completion.

Exploration 1.1 pins the completed analysis batch together with each published version. `view: "records"` requires `queryId` and `versionId` and returns per-asset columns, stable record/feature IDs and a bounded page. `view: "map"` reuses the same result set with an optional WGS84 `[west,south,east,north]` bounding box. Cursors are bound to their view and filters. Re-run the specification to include an analysis completed after the original query. Counts describe indexed records, while resource readiness and coverage disclose unparsed sources.

Exploration 1.2 adds `view: "graph"` on the same authorized manifest. Optional `versionId` narrows the resource graph; `recordId` additionally requires that version and a record in its pinned analysis. Typed resource/version/asset/evidence nodes express authoritative containment, with a focused record sharing its table/map identity. Asset nodes retain source hashes. This provenance view does not infer scientific relationships. Pages include at most 100 versions, 200 assets and 100 evidence fragments; `truncated` discloses omitted nodes and `nextCursor` pages remaining versions. Graph cursors cannot be reused across focus changes. Earlier 1.0 and 1.1 schema definitions remain archived.

Exploration 1.3 adds exact provider names, registration kinds, and content/spatial readiness filters to `QuerySpec`. The result summary counts the entire authorized pinned set, separately from the current resource page. Completed analysis with no content assets is `METADATA_ONLY`; parsed empty content is `EMPTY`; parsed content without verified geometry is `NO_SPATIAL_DATA`, while unknown or untransformable source coordinates are `CRS_UNVERIFIED`. Invalid, restricted and unsupported unparsed content retains unknown counts. Physical format companions do not establish analytical availability. Indexed content records include source representations and document/archive records, not deduplicated scientific observations. The 1.0–1.2 schemas remain immutable in the contract archive.

Exploration 1.4 permits `recordId` in `view: "records"`, together with `queryId` and `versionId`, to retrieve one exact record from the pinned analysis. The API resolves its source asset; an explicitly different asset or a record outside the query returns not found. Exact-record lookups cannot use continuation cursors. Existing resource, record-page, map and graph semantics remain version-scoped, and the 1.3 schemas remain archived.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Exploration 1.6 forwards the strict asset-bound `recordQuery` through this same capability: one explicit version, schema-validated typed filters, stable field sorting and column projection. Records, map tiles and focused graph records share its immutable conditions; consult Data REST for bounds and null/numeric semantics.

Exploration 1.7 adds `view: "aggregate"` with an existing `queryId`, `versionId` and `aggregate` source specification. Text groups or positive-width numeric bins combine with count/sum/mean/min/max. Every grouping, value and optional unit field is checked against the pinned source schema; units are partitioned without conversion. The existing record predicates and authorization apply before grouping. Counts reconcile valid, missing and invalid measure values; count includes every matching record. Decimal results remain strings, numeric bins carry an exact upper bound, and the response contains at most 200 groups with full group/record counts and explicit truncation. Null group/unit labels include missing, non-scalar or over-4096-character labels; invalid numeric group values also enter the null bucket. Unknown units remain unspecified. The Web statistics tab supplies the fields form, a chart and exact-value table; selecting a representable group creates shared record conditions. Numeric charts approximate finite decimal values while the table retains exact source arithmetic. The 1.6 discovery schemas remain immutable.

Record pages treat `first` as a maximum and also enforce a conservative 3 MiB response budget. PostgreSQL measures the ordered candidate prefix before returning original content; selected columns are projected before measuring. The cursor advances by the records actually returned, so byte-limited pages neither skip nor duplicate records. Metadata/specification overhead is reserved, and a single record that cannot fit fails explicitly instead of truncating its fields. Record views return geometry presence for identity; complete map geometry remains in the map representation.
