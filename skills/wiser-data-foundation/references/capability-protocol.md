# Capability protocol

## Request context

REST requests carry the bearer credential plus `X-Wiser-Tenant-Id`, `X-Wiser-Project-Id`, and `X-Wiser-Purpose`. The MCP gateway receives those values from trusted runtime configuration and keeps them out of tool arguments. Start discovery at `GET /api/data/v1/capabilities`.

Commands require a UUID `Idempotency-Key`. Versioned commands also require a strong `If-Match: "vN"`; the corresponding MCP argument is `expectedVersion`. Read current state after any timeout or conflict.

## Static mappings

| Capability                    | REST relative to `/api/data/v1`                             | MCP tool                       |
| ----------------------------- | ----------------------------------------------------------- | ------------------------------ |
| `data.catalog.search`         | `GET /catalog/data-items`                                   | `data_catalog_search`          |
| `data.catalog.get`            | `GET /catalog/data-items/{dataItemId}`                      | `data_catalog_get`             |
| `data.query`                  | `POST /query`                                               | `data_query`                   |
| `data.search.federated`       | `POST /search`                                              | `data_search_federated`        |
| `data.knowledge.search`       | `POST /knowledge/search`                                    | `data_knowledge_search`        |
| `data.graph.expand`           | `POST /graph/expand`                                        | `data_graph_expand`            |
| `data.graph.findPath`         | `POST /graph/find-path`                                     | `data_graph_find_path`         |
| `data.geo.query`              | `POST /geo/query`                                           | `data_geo_query`               |
| `data.geo.intersect`          | `POST /geo/intersect`                                       | `data_geo_intersect`           |
| `data.ingestion.create`       | `POST /ingestions`                                          | `data_ingestion_create`        |
| `data.ingestion.submit`       | `POST /ingestions/{ingestionId}/submit`                     | `data_ingestion_submit`        |
| `data.operation.get`          | `GET /operations/{operationId}`                             | `data_operation_get`           |
| `data.catalog.create`         | `POST /catalog/data-items`                                  | `data_catalog_create`          |
| `data.catalog.versions.list`  | `GET /catalog/data-items/{dataItemId}/versions`             | `data_catalog_versions_list`   |
| `data.catalog.versions.get`   | `GET /catalog/data-items/{dataItemId}/versions/{versionId}` | `data_catalog_version_get`     |
| `data.uploadSession.create`   | `POST /upload-sessions`                                     | `data_upload_session_create`   |
| `data.uploadSession.complete` | `POST /upload-sessions/{uploadSessionId}/complete`          | `data_upload_session_complete` |
| `data.ingestion.get`          | `GET /ingestions/{ingestionId}`                             | `data_ingestion_get`           |
| `data.ingestion.approve`      | `POST /ingestions/{ingestionId}/approve`                    | `data_ingestion_approve`       |
| `data.ingestion.reject`       | `POST /ingestions/{ingestionId}/reject`                     | `data_ingestion_reject`        |
| `data.operation.cancel`       | `POST /operations/{operationId}/cancel`                     | `data_operation_cancel`        |
| `data.operation.events`       | `GET /operations/{operationId}/events` (SSE snapshot)       | `data_operation_events`        |

The Registry schema is authoritative if this table ever differs from a running server.

## Operations

An asynchronous command returns one `operationId`, status, and `operation://...` resource. Poll `data.operation.get` with bounded backoff. `WAITING_INPUT` means the deterministic pipeline needs caller-supplied information; `WAITING_REVIEW` means a human authorization gate; `SUCCEEDED`, `FAILED`, and `CANCELLED` are terminal.

Operation events are append-only. Continue from the returned cursor rather than replaying an unbounded stream.

## Resources

The MCP gateway exposes only governed HTTP-backed templates:

```text
data://items/{dataItemId}/versions/{versionId}
evidence://fragments/{evidenceId}
operation://{operationId}
schema://capabilities/{capabilityId}/{version}
stac://collections/{collectionId}/items/{itemId}
```

Resources never grant additional access; the API reauthorizes every read.
