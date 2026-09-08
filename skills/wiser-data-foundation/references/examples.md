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

## 同一条件下查看记录与地图

先通过资源查询与 `view: "records"` 取得当前版本、文件 `assetId` 和原始 `columns`；字段键不能从其他文件沿用。探索 1.6 可在一个显式版本内建立文件级条件：

```json
{
  "spec": {
    "versions": [{ "dataItemId": "{dataItemId}", "versionId": "{versionId}" }],
    "recordQuery": {
      "assetId": "{assetId}",
      "filters": [
        {
          "field": "{numericFieldKey}",
          "type": "number",
          "operator": "gte",
          "value": 0
        }
      ],
      "sort": {
        "field": "{numericFieldKey}",
        "type": "number",
        "direction": "desc"
      },
      "columns": ["{identifierFieldKey}", "{numericFieldKey}"]
    }
  },
  "view": "resources"
}
```

随后使用返回的 `queryId` 请求 `view: "records"`（带同一 `versionId`）、`view: "map"` 或图谱记录回查。地图瓦片也沿用该查询，不在客户端另做权限或条件过滤。编号使用文本条件以保留前导零；缺失值用 `type: "presence"` 与 `operator: "isNull"` / `"isNotNull"`。排序与筛选不改写原始值，也不表示不同字段或文件的单位可以直接相加。

## 聚合完整查询中的来源记录

探索 1.7 使用已有 `queryId` 和固定版本完成服务端聚合。先发现字段键，再调用同一 `data_explore_query`：

```json
{
  "queryId": "{queryId}",
  "versionId": "{versionId}",
  "view": "aggregate",
  "aggregate": {
    "assetId": "{assetId}",
    "groupBy": { "field": "{stationFieldKey}", "type": "text" },
    "measure": { "operation": "mean", "field": "{numericFieldKey}" }
  }
}
```

聚合沿用查询的记录条件，不下载并排空所有记录分页。`measure.operation` 支持 count / sum / mean / min / max；来源有单位字段时，数值操作传入 `unitField`，不同单位自动分组且不换算。未知单位明确保留，不据字段名称推断。数值分桶使用 `groupBy: {"field":"{numericFieldKey}","type":"number","interval":10}`，返回精确桶起点和 `upperBound`。

核对 `totalCount`、`aggregate.groupCount`、`truncated` 和每组有效／缺失／无效数量。最多返回 200 组；截断结果不能代表全部分布，需缩小查询。统计值为十进制字符串；展示精确值时保留字符串。空分组包含无法分组的值，不能把它简化为只筛选缺失值。
