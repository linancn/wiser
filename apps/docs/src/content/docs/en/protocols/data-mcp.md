---
title: Data MCP integration
description: Invoke 22 Data Capabilities and five governed Resources through the shared WISER MCP Gateway.
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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 76f3f6d4967c0f7fc13b06ca1480244121a90272
---

## HTTP adapter only

Data MCP is a static `WiserMcpModule` in the existing WISER MCP Gateway, not another business implementation. Both stdio and stateless Streamable HTTP call `/api/data/v1`; they never connect to data-postgres, SeaweedFS, or a projection and never hold a Supabase service-role key.

The module registers 22 strict Zod Tools from the ordered `@wiser/data-contracts` Registry. Tool names, input schemas, query/command annotations, and REST mappings come from the same Capability definitions at runtime. There is no AST scanning, general SQL/Cypher/DSL Tool, or discovered database command.

## Data API configuration

All five values appear together. With none present, Gateway starts only Agent EXCON MCP; partial configuration fails closed:

```bash
export DATA_API_URL=http://127.0.0.1:3001/api/data/v1/
export DATA_API_BEARER_TOKEN=<supabase-jwt-or-wdc1-delegated-credential>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console
```

`DATA_API_URL` must be HTTP(S), have no userinfo/query/fragment, and end in `/api/data/v1/`. Bearer length is 16–8192 characters with no control characters. Tenant/Project are UUIDs, and Purpose is a bounded safe identifier.

The shared Gateway process initializes its Agent EXCON HTTP client first. Even when a caller uses only Data Tools, the current standalone process therefore needs valid EXCON API configuration:

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v2
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/
export AGENT_EXCON_API_KEY=<credential-bound-to-one-run-agent>
```

`AGENT_EXCON_API_KEY` and `DATA_API_BEARER_TOKEN` identify callers in different systems and cannot substitute for each other. A local Compose placeholder can satisfy process configuration, but it does not make EXCON Tools callable under unified Auth.

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

## The 22 Tools

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

1. use `data_catalog_search` to obtain authorized DataItems and a cursor;
2. pin immutable `versionId` through `data_catalog_get` or `data_catalog_version_get`;
3. select `data_query`, `data_search_federated`, `data_knowledge_search`, graph, or geo Tools;
4. inspect each result's `versionId`, `evidenceId`, security, quality, acceptance, and limitations;
5. never treat a search score as quality or authorization.

### Ingestion

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
    "message": "The Data Foundation API could not complete the request.",
    "action": "Reconcile identity, scope, and Operation status before a safe retry."
  }
}
```

This distinction preserves only the identity class; it never forwards API `details`, resource existence, or internal scope lists. MCP Resource reads still converge downstream failures to safe `DATA_RESOURCE_UNAVAILABLE` so the Resource error surface cannot reveal hidden content.

## Safe retry

Retry a Query with the same cursor and filters. Retry a command only with identical principal, Tenant, Project, Purpose, Tool, arguments, and `idempotencyKey`; a versioned command preserves `expectedVersion`. After an ambiguous failure, reconcile with `data_operation_get` or the smallest catalog/ingestion GET instead of blindly generating a new key.

MCP does not persist bearers, upload ids, multipart ETags, or Operation cursors for the caller. Keep that state in a protected, recoverable location outside Agent-visible content.
