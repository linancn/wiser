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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 76f3f6d4967c0f7fc13b06ca1480244121a90272
---

## Endpoint and authority contract

Data GraphQL runs in the shared Fastify API:

```text
POST /graphql
Content-Type: application/json
```

It uses Mercurius with schema-first SDL and no decorator or TypeScript AST scanning. GraphQL fields are projections of the 22 Capabilities. Resolvers and REST call the same `DataCapabilityHandler`, preserving Zod input/output validation, scopes, security ceiling, purpose, timeout, idempotency, and audit semantics.

Runtime pins GraphQL `16.14.2` and Mercurius `16.10.0` exactly. This is the latest compatible combination actually built under Fastify 5, Node 24, and TypeScript 7. GraphQL 17 is outside this delivery's supported and validated peer-runtime boundary; following a major never replaces build evidence.

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

## Mutation fields

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
curl --fail http://127.0.0.1:3001/graphql \
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
curl --fail http://127.0.0.1:3001/graphql \
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
