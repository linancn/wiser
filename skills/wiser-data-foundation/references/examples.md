# Workflow examples

The examples show request shape, not real credentials or identifiers. Resolve all UUIDs and the bearer from trusted context.

## 目录搜索

REST:

```http
GET /api/data/v1/catalog/data-items?query=永定河&businessDomains=water-monitoring&first=20
X-Wiser-Tenant-Id: {tenantId}
X-Wiser-Project-Id: {projectId}
X-Wiser-Purpose: analysis
```

Pin the returned `dataItemId` and immutable `versionId` before a reproducible query.

## 知识检索

MCP `data_knowledge_search`:

```json
{
  "query": "生态补水的时空约束是什么？",
  "dataItemIds": ["{dataItemId}"],
  "minimumConfidence": 0.75,
  "first": 10
}
```

Preserve each result's evidence ID, limitations, quality grade, acceptance status, and security level.

## 空间相交

MCP `data_geo_intersect`:

```json
{
  "left": { "dataItemId": "{dataItemId}", "versionId": "{versionId}" },
  "right": {
    "geometry": {
      "type": "Polygon",
      "coordinates": [[...]],
      "crs": "EPSG:4490"
    }
  },
  "first": 100
}
```

Do not replace the structured target with SQL or a backend-specific expression.

## 创建上传会话

Call `data_upload_session_create` with file name, media type, byte size, and SHA-256 when known. Use the returned single PUT or ordered multipart plan before expiry. The URL is ephemeral; redact it from notes and logs.

Complete with `data_upload_session_complete`, the current `expectedVersion`, exact object size/hash, and ordered multipart ETags when required. Give the command a new UUID idempotency key.

## 创建入库会话

MCP `data_ingestion_create`:

```json
{
  "assetIds": ["{geojsonAssetId}", "{evidenceAssetId}"],
  "ownerProjectId": "{projectId}",
  "intendedUses": ["hydrology-analysis", "evidence-grounding"],
  "requestedSecurityLevel": "L1_INTERNAL",
  "idempotencyKey": "{freshUuid}"
}
```

## 提交入库

MCP `data_ingestion_submit`:

```json
{
  "ingestionId": "{ingestionId}",
  "expectedVersion": 1,
  "idempotencyKey": "{freshUuid}"
}
```

Persist the returned `operationId`. Do not create a second ingestion because polling is slow.

## 查询 Operation

Use `data_operation_get` with the same `operationId`. Poll with bounded backoff and stop at a terminal state. Use `data_operation_events` only as a bounded append-only history/cursor, not as a replacement for current state.

## 等待审核

At `WAITING_REVIEW`, retrieve `data_ingestion_get` and present:

- exact input assets and hashes;
- schema/semantic plan and Agent-run provenance;
- deterministic checks, quality grade, and blocking failures;
- inherited security level and intended uses;
- before/after transformation diff, limitations, and proposed conditions.

An authorized reviewer uses `data_ingestion_approve` or `data_ingestion_reject` with the current `expectedVersion` and a fresh idempotency key. Never auto-approve from Agent confidence.
