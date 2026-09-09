---
title: Data GraphQL API
description: Data Foundation schema-first GraphQL 的字段、统一 Handler、身份、上限与 mutation 语义。
docType: protocol-reference
scope: data-graphql-api
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 实现或调用 Data Foundation GraphQL API 时
whenToUpdate:
  - SDL、resolver、Capability mapping、身份、上限或错误语义变化时
checkPaths:
  - apps/api/src/data-foundation/schema.graphql
  - apps/api/src/data-foundation/graphql-module.ts
  - packages/data-contracts/src/capability/**
lastReviewedAt: 2026-09-09
lastReviewedCommit: b57c120df93cf8ac60ba243afaf3840ea6082a14
---

## 入口与权威契约

Data GraphQL 运行在共享 Fastify API：

```text
POST /graphql
Content-Type: application/json
```

实现使用 Mercurius 的 schema-first SDL，不使用 decorator 或 TypeScript AST 扫描。GraphQL field 只是 29 项 Capability 的投影；resolver 与 REST 调用同一个 `DataCapabilityHandler`，因此输入/输出 Zod 校验、Scope、安全 ceiling、Purpose、timeout、幂等和 audit 语义一致。

GraphQL 与 Mercurius 的精确兼容版本由 `apps/api/package.json` 和根 lockfile 定义，并由 API typecheck/build 验证。协议文档不复制会随依赖升级变化的版本清单。

SDL 位于 `apps/api/src/data-foundation/schema.graphql`，运行时同一常量有回归测试。Capability 的完整 JSON Schema 与版本仍以 `GET /api/data/v1/capabilities` 为权威发现入口。

## 身份 Header

每个 GraphQL 请求都必须携带：

```http
Authorization: Bearer <supabase-jwt-or-wdc1-delegated-credential>
X-Wiser-Tenant-Id: <tenant-uuid>
X-Wiser-Project-Id: <project-uuid>
X-Wiser-Purpose: <bounded-purpose>
```

API 重新解析 Supabase Membership/Role/Scope 并验证 Tenant/Project 与返回上下文完全一致。未认证返回 HTTP `401` 和 `NOT_AUTHENTICATED`；字段不存在与越权仍遵循相应 Capability 的 fail-closed 语义。

每个 mutation HTTP 请求还要求 UUID：

```http
Idempotency-Key: <uuid>
```

一个请求只允许一个 mutation field，因此一个 key 只对应一条 command。重试必须使用完全相同的 operation name、variables、身份上下文和 key。

## Query fields

`dataCatalog(filter: { includeTotal: true })` 在 `nodes`、`pageInfo` 之外返回可空的 `totalCount`。它是精确非负整数，使用 GraphQL Float 避免 32 位 Int 上限，并限制在 JavaScript 安全整数精度内。计数覆盖已授权且符合筛选的完整目录，不是当前页大小；省略参数时计数为 null。

| Field                 | Capability                   | 作用                                                     |
| --------------------- | ---------------------------- | -------------------------------------------------------- |
| `dataCatalog`         | `data.catalog.search`        | 游标目录 connection                                      |
| `dataItem`            | `data.catalog.get`           | 一个 DataItem 与可选版本                                 |
| `dataQuery`           | `data.query`                 | 结构化字段/过滤查询                                      |
| `dataSearch`          | `data.search.federated`      | 多后端 RRF 综合检索                                      |
| `knowledgeSearch`     | `data.knowledge.search`      | 证据/知识检索                                            |
| `graphExpand`         | `data.graph.expand`          | 有界实体邻域                                             |
| `graphFindPath`       | `data.graph.findPath`        | 有界关系路径                                             |
| `geoQuery`            | `data.geo.query`             | 受控空间谓词                                             |
| `geoIntersect`        | `data.geo.intersect`         | 两个受控空间目标相交                                     |
| `dataOperation`       | `data.operation.get`         | 一个 Operation                                           |
| `dataItemVersions`    | `data.catalog.versions.list` | 版本 connection                                          |
| `dataItemVersion`     | `data.catalog.versions.get`  | 精确不可变版本                                           |
| `dataIngestion`       | `data.ingestion.get`         | 入库会话、质量/Agent/投影摘要                            |
| `dataOperationEvents` | `data.operation.events`      | 有界 Operation event page；GraphQL 返回 JSON，不使用 SSE |

Connection 返回 `nodes` 与 `pageInfo { endCursor hasNextPage }`。其余分页结果保留 `nextCursor`。Cursor 是不透明、scope-bound 的；不能从 REST、另一个 Tenant/Project 或旧授权版本复制。

`geoQuery(input: GeoQueryInput!)` 接受一个可选的 `versionId`。省略时，每个有界响应从各 DataItem 的最新可见且已提交版本选择 extent；指定时则从该精确不可变版本选择 extent，并以绑定 snapshot/query/scope 的不透明 `nextCursor` 继续。可选 `dataItemIds` 与两种选择均取交集。版本不可见或不存在时返回空结果集，不泄露其存在性。

`geoIntersect` 会先选择 DataItem target 的可见已提交 Version，再收集全部 sibling extent；target 缺失、不可见、无 extent 或彼此不相交时返回同样的空结果，绝不回退历史版本。当前 catalog 输出必须包含 `DataItemVersion.tileAvailability { vector raster }`；它表示受控 source 可路由，不代表 GIS 上游健康或 COG 证明。

## Mutation fields

`CreateIngestionInput.sourceRegistration` 是入库 1.1 严格描述的可选 JSON 映射。GraphQL 与 REST 使用相同的清单绑定、授权、幂等、校验和“仅来源登记”语义；JSON scalar 不绕过 Capability schema。

| Field                       | Capability                    | 结果                                  |
| --------------------------- | ----------------------------- | ------------------------------------- |
| `createDataIngestion`       | `data.ingestion.create`       | 创建异步 Operation                    |
| `createDataItem`            | `data.catalog.create`         | 创建目录 DataItem                     |
| `createDataUploadSession`   | `data.uploadSession.create`   | 生成受控上传计划                      |
| `completeDataUploadSession` | `data.uploadSession.complete` | 核对并完成上传                        |
| `submitDataIngestion`       | `data.ingestion.submit`       | 读取当前版本后提交持久任务            |
| `approveDataIngestion`      | `data.ingestion.approve`      | 消费显式 `expectedVersion` 的审核批准 |
| `rejectDataIngestion`       | `data.ingestion.reject`       | 消费显式 `expectedVersion` 的拒绝     |
| `cancelDataOperation`       | `data.operation.cancel`       | 读取当前版本后请求取消                |

GraphQL 没有隐式“成功即发布”。长任务返回统一 `Operation`，调用方继续用 `dataOperation`/`dataOperationEvents` 对账。upload Session 返回的预签名 URL 仍由客户端直接 PUT/上传分片；GraphQL 进程不代理大文件正文。

## 查询示例

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

真实 ID 必须来自已授权目录结果。不要把 bearer 写入 query/variables、GraphQL 日志或客户端缓存。

## Mutation 示例

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

示例中的 UUID 是占位值。实际 `assetIds` 必须来自当前 Project 中已完成的 upload Session，`ownerProjectId` 必须等于授权 Project。

## 资源与执行上限

运行时固定：

- query depth 默认最大 8；
- complexity 默认最大 500；带 `first` 的高成本 field 按最多 100 倍计权；
- HTTP query timeout 默认 30 秒；Capability 自身还受 Registry timeout 约束；
- 禁止 batched queries；
- 禁止 subscription；
- 禁止一个 mutation operation 选择多个 mutation field；
- GraphiQL 关闭；生产关闭 introspection；
- query 文本最大 100,000 字符；
- 响应 `private, no-store`。

`CapabilityLoader` 在单请求内按 `capabilityId + canonical input` 复用相同查询 Promise；`DataItem.selectedVersion` 使用 Mercurius loader 批量解析。Loader 只优化同一已授权请求，不跨身份或请求缓存授权结果。

## 字段级授权

`DataItem.sourceOrganization` 只有在实时 Scope 包含 `data.catalog.sensitive.read` 时返回；否则为 `null`。其余字段仍经过 Capability 输出 schema 与底层 RLS/脱敏。客户端不能用 fragment、alias、introspection 或错误差异推断不可见字段。

Graph、Geo、Search field 始终使用结构化输入和服务端参数化 adapter，不暴露通用 SQL/Cypher/DSL scalar。

## 错误与安全重试

GraphQL validation/execution error 返回固定安全 message，`extensions.code` 保留稳定类别；底层 SQL、对象存储、投影正文、Scope 清单或资源存在性不会进入错误：

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

无效/过大的请求通常返回 HTTP `400`；身份缺失返回 `401`；成功进入 GraphQL 执行但 field 失败时响应通常为 HTTP `200` 加 `errors`。调用方必须同时检查 HTTP 与 GraphQL envelope。

Query 可按相同 cursor 安全重试。Mutation 只能以相同身份、operation、variables 与 `Idempotency-Key` 重试；同 key 不同 variables 是冲突。之后通过 `dataOperation` 或最小资源 Query 对账。

## 共享探索

`dataExplore(input: JSON!): JSON!` 调用 `data.explore.query`，与 REST 共享严格 `QuerySpec`、绑定用户的 `queryId`、固定版本成员、有效期与资源响应。要求 `data.query.execute` 和 `data.catalog.read`，复杂度权重与 `dataQuery` 相同。首次输入 `{spec:{text:"water"},view:"resources",first:20}`，后续使用返回的 `queryId`，并将 `nextCursor` 传入 `after`。

`data.analysis.create` 接收已发布的 `dataItemId` / `versionId` 和幂等键，原子创建带审计的操作与持久化分析任务，不改变来源登记与质量声明。REST：`POST /api/data/v1/analyses`；GraphQL：`createDataAnalysis(input: JSON!)`；MCP：`data_analysis_create`。需要 `data.ingestion.write` 与 `data.catalog.read` 权限；通过返回的操作 ID 查询进度。

探索契约 1.1 将已完成的分析批次与已发布版本共同固定。`view: "records"` 必须提供 `queryId` 和 `versionId`，返回逐资产字段定义、稳定的记录/要素 ID 及有界分页。`view: "map"` 复用同一结果集，支持可选的 WGS84 `[west,south,east,north]` 范围。游标绑定视图与过滤条件。要纳入原查询之后完成的分析，需要重新运行查询条件。数量表示已索引记录，资源就绪状态与覆盖信息同时披露未解析来源。

探索契约 1.2 在同一授权清单上增加 `view: "graph"`。可选 `versionId` 缩小资源图范围；`recordId` 还要求该版本及其固定分析批次中的记录。资源、版本、文件和证据节点具有明确类型，关系表示权威包含关系；聚焦记录与表格、地图共用身份，文件节点保留来源哈希。这一溯源视图不推断科学关系。每页最多包含 100 个版本、200 个文件和 100 个证据片段；`truncated` 披露省略节点，`nextCursor` 翻阅后续版本，改变聚焦条件不能复用游标。此前 1.0 与 1.1 的契约定义保留在归档中。

探索契约 1.3 在 `QuerySpec` 中增加提供机构完整名称、登记类型以及内容/空间就绪状态筛选。汇总统计整个已授权且固定版本的结果集，与当前资源页分别显示。分析完成但没有内容资产时为 `METADATA_ONLY`；已解析的空内容为 `EMPTY`；已解析内容没有验证几何时为 `NO_SPATIAL_DATA`，坐标系未知或无法可靠转换时为 `CRS_UNVERIFIED`。无效、受限或不支持的未解析内容保留未知数量；物理格式伴随文件不能证明分析内容可用。已索引内容记录包括来源的多种表示、文档和压缩包记录，不表示已去重的科学观测。契约归档中的 1.0–1.2 定义保持不变。

探索契约 1.4 允许在 `view: "records"` 中同时提供 `queryId`、`versionId` 和 `recordId`，从固定分析批次回查一条明确记录。API 自动定位所属文件；若明确指定的文件不匹配，或记录不属于该查询，则返回未找到。单记录回查不能附带续页游标。资源、记录分页、地图和图谱仍绑定版本范围，1.3 契约保留在归档中。

查询结果矢量入口为 `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf`，额外要求 `data.query.execute` 与 `data.catalog.read`。每次请求均在 RLS 下重新校验当前用户的查询清单及全部固定版本和分析批次，然后才调用 Martin。调用方不得提交查询参数，七项范围值全部来自已验证上下文和路径。响应使用 `exploration` 图层及 `Cache-Control: no-store`；过期、撤权或属于其他用户的查询不会访问上游。现有按版本瓦片保留原路径和图层。

探索契约 1.5 增加可选的地图整体 `spatial.bounds`（WGS84；空结果为 null）及 `mercatorFeatureCount`，由同一授权记录集合计算，不受分页影响。浏览器只请求一条初始记录与范围摘要，定位整个结果范围，再按视口加载同源查询瓦片。点选单要素通过 1.4 的精确记录回查获取详情，点选聚合点继续放大。地图分别标明视口要素／聚合点数与可上图记录总数。追加迁移 `0015_exploration_tile_boundaries.sql` 明确接缝点的唯一瓦片归属，防止重复计数。1.4 契约仍保留在归档中。

探索 1.6 通过同一能力传递严格文件级 `recordQuery`：一个显式版本、经来源字段模式校验的类型化条件、稳定字段排序和列选择。记录、地图瓦片与图谱记录回查共享不可变条件；边界及空值／数值语义见 Data REST。

探索 1.7 增加 `view: "aggregate"`，使用已有 `queryId`、`versionId` 和 `aggregate` 来源配置。文本分组或正数宽度的数值分桶支持计数、求和、均值、最小值与最大值。分组、数值及可选单位字段均校验固定来源模式；不同单位分别统计且不换算。聚合前应用既有记录条件与授权。有效、缺失和无效数值数量可以对账；计数包含所有匹配记录。十进制结果保留为字符串，数值桶返回精确上界；最多返回 200 个分组，并明确完整分组／记录数量及截断状态。空分组／单位标签包含缺失、非标量及超过 4096 字符的标签，无效数值分组也归入空桶；未知单位仍标为未注明。Web 统计页提供字段表单、图表和精确值表格，点击可表达为条件的分组生成共享记录查询。数值图表近似显示有限十进制值，表格保留精确计算值。1.6 发现模式保持不可变。

记录页将 `first` 视为条数上限，同时实施保守的 3 MiB 响应预算。PostgreSQL 先计算有序候选前缀的大小，再返回完整原始内容；选择列时先投影再计量。游标按实际返回条数推进，因字节预算缩小的页不会跳过或重复记录。预算预留元数据与查询配置开销，单条记录仍无法容纳时明确失败，不截断字段。记录视图仅返回用于身份判断的几何存在状态，完整地图几何仍由地图表示提供。

探索协议 1.8 增加时间条件、时间排序，以及小时、日、月、年聚合。源格式为 `iso-offset`、`dmy-local` 或 `ymd-local`；`utcOffsetMinutes` 必须明确填写 −840 至 840 的固定偏移，不推断时区或夏令时。ISO 源值使用自身偏移；无偏移的源时间使用配置偏移，该偏移同时定义日历分组。无效日期归入无法分组，不自动修正。边界使用最多六位小数的 UTC 字符串，范围采用包含起点的 `gte` 和不包含终点的 `lt`，源字符串保持不变。浏览器支持时间折线、完整时间段刷选和等价的键盘范围控件，不同单位使用独立序列。所有视图及 MVT 复用相同条件。1.7 发现协议保持不可变。

探索协议 1.9 支持新 `spec` 同时携带 `baseQueryId`。服务端先重新授权当前用户的完整基础查询，再创建新查询；匹配范围限定为基础查询已固定的版本，并保留各版本的解析批次 ID（含未解析的空值）。显式版本不能扩展到基础范围外。基础查询过期、无权访问或权限撤销时明确失败，不静默切换至新解析批次。Web 记录条件与图表选择使用此细化路径；普通新搜索仍解析当前可访问版本。1.8 发现协议保持不变。

探索协议 1.10 增加不可变的 `spec.spatialBounds`，按 WGS84 西、南、东、北排列。记录、聚合、图谱记录回查和查询 MVT 在聚合前使用相同的已验证几何相交条件。资源及来源图概览显示匹配版本；来源就绪统计仍表示已索引内容。查询清单保留底层授权范围的版本与批次，使通过 `baseQueryId` 清除或改变范围时不刷新解析结果、不丢失原始范围。即使位于地图范围外，所有固定成员仍需重新授权。地图提供点、线、面显隐、图例、本地字体聚合数量与视口筛选；图层显隐只改变呈现，不改变查询授权或计数。未验证坐标的数据明确排除。1.9 发现协议保持不可变。

探索协议 1.11 增加 `graph.detail`（`assets`、`evidence`、`records`），按固定版本分页展开邻居；记录展开还需指定来源文件。`graph.grain` 标明 `totalCount` 的计数单位。游标绑定焦点、展开类型与关系筛选；记录复用共享条件、固定解析批次及字节预算。`graph.relations` 筛选包含／来源关系。可选 `graph.path` 在关系筛选后的当前返回页内查找最多八条边的有向最短路径；端点不在本页时明确失败，不泄露外部节点。未找到路径只说明本页中没有路径，不代表完整知识库中不存在。1.10 契约保持不可变。

保存视图使用 `data.explore.view.create`、`.list`、`.open` 和 `.revoke`；`data.explore.export` 导出一次有界查询表示。均要求 `data.query.execute` 与 `data.catalog.read`。创建／撤销为同步命令，必须携带 UUID `Idempotency-Key`，并原子写入审计与命令账本。视图保存原 QuerySpec、版本／解析批次，以及类型化 ViewSpec（视图请求、分页历史、选择身份、地图视角与图层），不复制记录正文。每位用户在项目内最多保留 100 个有效视图。默认私人可见；显式项目分享仍需当前登录用户的项目范围、用途与安全级别检查，打开时重新授权每个固定成员。列表仅返回当前用户自己的保存配置。打开时重新签发本人绑定的 30 分钟查询和游标，不解析更新版本或批次；原临时查询到期不影响持久配置。仅创建者可以单向撤销。导出重新授权请求，返回原始值、来源、明确的返回／总量和计数单位；后续页或截断结果不会标成完整。各传输入口不会在 SSR/BFF 内排空所有分页。

保存视图查询为 `dataExploreViews(input: JSON!)`, `dataExploreView(input: JSON!)`, `exportDataExplore(input: JSON!)`; 变更为 `createDataExploreView(input: JSON!)`, `revokeDataExploreView(input: JSON!)`. 均返回 JSON，并沿用命令幂等请求头；复杂度计算使用较高权重。
