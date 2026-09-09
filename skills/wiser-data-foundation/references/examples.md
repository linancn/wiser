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

## 显式时间范围与日历聚合

先发现本文件字段、时间格式与来源偏移。下列示例明确采用固定 UTC+08:00，只有来源证据支持该配置时才能使用；它不代表 IANA 时区或夏令时推断。通过 `data_explore_query` 在已固定查询内细化：

```json
{
  "baseQueryId": "{queryId}",
  "spec": {
    "versions": [{ "dataItemId": "{dataItemId}", "versionId": "{versionId}" }],
    "recordQuery": {
      "assetId": "{assetId}",
      "filters": [
        {
          "field": "{timeFieldKey}",
          "type": "time",
          "format": "dmy-local",
          "utcOffsetMinutes": 480,
          "operator": "gte",
          "value": "2024-07-01T00:00:00+08:00"
        },
        {
          "field": "{timeFieldKey}",
          "type": "time",
          "format": "dmy-local",
          "utcOffsetMinutes": 480,
          "operator": "lt",
          "value": "2024-08-01T00:00:00+08:00"
        }
      ]
    }
  },
  "view": "resources"
}
```

使用新返回的 `queryId` 查询日历分组；字段与单位须来自同一资产：

```json
{
  "queryId": "{refinedQueryId}",
  "versionId": "{versionId}",
  "view": "aggregate",
  "aggregate": {
    "assetId": "{assetId}",
    "groupBy": {
      "field": "{timeFieldKey}",
      "type": "time",
      "format": "dmy-local",
      "utcOffsetMinutes": 480,
      "bucket": "day"
    },
    "measure": { "operation": "count" }
  }
}
```

时间桶返回绝对上下界。钻取时保持全部现有条件，并追加 `gte` / `lt`；不能丢弃数值、单位或空间条件。格式无效的日期不当作有效观测时间。

## 统一空间条件与有界图谱

`spec.spatialBounds: [west,south,east,north]` 是跨视图的 WGS84 已验证几何条件；地图请求的 `bbox` 只限制地图页面范围。通过 `baseQueryId` 修改或移除 `spatialBounds` 时保留原有版本和分析批次。没有空间信息、坐标系未验证、仅登记入口的数据仍可在资源目录发现，不能给它们伪造位置。

从资源或记录响应取得固定版本与资产，再调用 `data_explore_query`：

```json
{
  "queryId": "{queryId}",
  "view": "graph",
  "versionId": "{versionId}",
  "assetId": "{assetId}",
  "first": 25,
  "graph": { "detail": "records", "relations": ["HAS_ASSET", "HAS_RECORD"] }
}
```

`detail` 支持 `assets`、`evidence`、`records`；记录展开需要明确 `assetId`，不能同时传 `recordId`。`nextCursor` 沿用相同焦点、关系与条件。读取 `graph.grain` 与 `truncated`，不要把版本、文件或证据数量当作观测记录数。路径使用当前返回的节点 ID：`graph.path: {"from":"{nodeId}","to":"{nodeId}","maxDepth":8}`，它只查找当前有界页中的有向来源关系，不证明科学因果或跨页无路径。

## 保存、项目分享与撤销

`data_explore_view_create` 保存已经执行的查询与视图，默认私有；只有用户明确要求分享时设置 `visibility: "project"`。条件草稿不属于已执行视图。

```json
{
  "queryId": "{queryId}",
  "title": "来源记录检查",
  "visibility": "private",
  "viewSpec": {
    "activeView": "records",
    "requests": {
      "records": {
        "queryId": "{queryId}",
        "view": "records",
        "versionId": "{versionId}",
        "assetId": "{assetId}",
        "first": 25
      }
    }
  },
  "idempotencyKey": "{freshUuid}"
}
```

REST 对应 `POST /api/data/v1/explore/views`：将 `idempotencyKey` 移到 `Idempotency-Key` 请求头。每次不同命令使用新 UUID；不确定是否成功时仅重试相同请求和 key。

保存配置保留原始版本与分析批次。`data_explore_view_open` 使用 `{"viewId":"{viewId}"}` 打开并重新授权，取得新的短期 `queryId`；后续请求必须使用返回的 `viewSpec.requests` 中重新绑定的 ID 与游标。`data_explore_view_list` 列出当前调用者拥有的视图。项目分享仍受 Tenant、Project、Purpose、安全等级和每项资源权限约束；Web 与 OAuth Agent 的 Purpose 可能不同，不应把分享链接视为跨 Purpose 授权。

可构造 Web 链接 `/{locale}/data-foundation/explore?saved={viewId}`，只包含不透明 ID。当前查询链接 `?query={queryId}` 属于创建者且会过期，不能代替持久分享。`data_explore_view_revoke` 使用 `viewId` 和新 `idempotencyKey` 撤销所有者的链接；它不撤销此前已经打开且仍有资源权限的短期查询。

REST 打开与撤销分别使用 `POST /explore/views/{viewId}/open` 和 `POST /explore/views/{viewId}/revoke`，请求体为 `{}`；`viewId` 已在路径中，不能再次放进 body。撤销仍需要 UUID 请求头。

## 导出当前有界结果

MCP `data_explore_export`：

```json
{
  "request": {
    "queryId": "{queryId}",
    "view": "records",
    "versionId": "{versionId}",
    "assetId": "{assetId}",
    "first": 25
  }
}
```

REST `POST /api/data/v1/explore/export` 使用相同 body。导出返回原始值、固定来源、执行请求和 `coverage`：核对 `unit`、`returnedCount`、`totalCount`、`complete`。它只导出这一个有界页，不排空全部游标；地图初始记录页也不等于所有瓦片。保留精确十进制字符串与来源空值，不在 Agent 中推断单位转换或补造观测值。
