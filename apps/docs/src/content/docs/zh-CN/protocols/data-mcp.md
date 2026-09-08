---
title: Data MCP 接入
description: 通过共享 WISER MCP Gateway 调用 24 项 Data Capability 与 5 类受控 Resource。
docType: protocol-reference
scope: data-mcp-adapter
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 通过 MCP 查询或入库 Data Foundation 时
  - 修改 Data MCP Tool、Resource、HTTP mapping 或 transport 时
whenToUpdate:
  - Tool、Resource、凭据、响应上限或 API mapping 变化时
checkPaths:
  - apps/mcp/src/data-foundation/**
  - apps/api/src/data-foundation/**
  - packages/data-contracts/src/capability/**
  - skills/wiser-data-foundation/**
lastReviewedAt: 2026-09-08
lastReviewedCommit: d88b0f5a3a4f451e8bbcb98d06d73a49a96eec58
---

## 只做 HTTP 适配

Data MCP 是现有 WISER MCP Gateway 的静态 `WiserMcpModule`，不是第二套业务实现。stdio 与无状态 Streamable HTTP 都调用 `/api/data/v1`，从不连接 data-postgres、SeaweedFS 或任一投影，也不持有 Supabase service-role key。

模块从 `@wiser/data-contracts` 的有序 Registry 注册 24 个 strict Zod Tool。Tool name、输入 schema、query/command 注解和 REST mapping 在运行时来自同一 Capability definition；不存在 AST 扫描、通用 SQL/Cypher/DSL Tool 或自动发现的数据库命令。

## Data API 配置

完整配置五项必须一起出现；全部缺失时只启动 Agent EXCON MCP，部分配置会失败关闭：

```bash
export DATA_API_URL=http://127.0.0.1:3101/api/data/v1/
export DATA_API_BEARER_TOKEN=<supabase-jwt-or-wdc1-delegated-credential>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console
```

`DATA_API_URL` 必须是 `http/https`、无 userinfo/query/fragment，并以 `/api/data/v1/` 结束。Bearer 长度为 16–8192 字符且不能包含控制字符。Tenant/Project 必须是 UUID，Purpose 必须是有界安全标识。

共享 Gateway 进程会先初始化 Agent EXCON HTTP client，所以即使调用方只使用 Data Tools，当前独立进程也必须提供非空且协议版本一致的 EXCON API 配置：

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v2
export AGENT_EXCON_API_URL=http://127.0.0.1:3101/api/v2/
export AGENT_EXCON_API_KEY=<configured-excon-key>
```

Data Tool 不会发送 `AGENT_EXCON_API_KEY`，因此 Data-only 本机进程可以使用占位值；一旦调用 `excon_*`，该值必须换成绑定具体 RunAgent 的真实 credential。它与 `DATA_API_BEARER_TOKEN` 不能互相替代。

| 验证层             | Credential                                       | 只负责                                  |
| ------------------ | ------------------------------------------------ | --------------------------------------- |
| MCP HTTP transport | `DATA_MCP_BEARER_TOKEN`                          | 允许调用 `POST /mcp`                    |
| Agent EXCON module | `AGENT_EXCON_API_KEY`                            | 绑定一个 RunAgent 的 `excon_*` 下游请求 |
| Data module        | `DATA_API_BEARER_TOKEN` + Tenant/Project/Purpose | `data_*` 下游授权上下文                 |

一个 Gateway request 可以发现两个模块，但不能把 transport 或某系统 principal 提升成另一系统的权限。

本地 stdio：

```bash
pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

同一 Gateway 注册 EXCON 与 Data 模块；二者使用各自的 API bearer 和身份绑定。

## Streamable HTTP

Compose 在 `http://127.0.0.1:13004/mcp` 运行无状态入口。独立启动时保留上面的 EXCON/Data API 配置，并追加：

```bash
export DATA_MCP_BEARER_TOKEN=<random-secret-at-least-16-characters>
export DATA_MCP_HOST=127.0.0.1
export DATA_MCP_PORT=3004

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start:http
```

有两层不同 credential：

1. `DATA_MCP_BEARER_TOKEN` 只用 timing-safe digest 比较保护 `POST /mcp` 边界；
2. `DATA_API_BEARER_TOKEN` 是下游 REST 请求的统一 WISER identity。

禁止把任一 token 放进 query、Tool 参数、Resource URI、日志、Telemetry 或 Git。`GET /health/live` 与 `/health/ready` 无需认证且禁止缓存；优雅关闭先让 ready 变为 false，再排空在途请求。每个 `/mcp` 请求创建新 server/transport，当前入口不签发或恢复 MCP session。

## 24 个 Tools

| MCP Tool                       | Capability                    | 类型    |
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

Query 使用 `readOnlyHint=true`；command 明确为非只读、幂等、非破坏性 open-world 操作。每个 command 输入在 Capability schema 上增加 UUID `idempotencyKey`。版本化 command 还携带 `expectedVersion`，适配器把它变为强 `If-Match: "vN"`，不把 transport 字段混入 JSON body。

GET Tool 只编码 boolean、number、string 或 string array query；path parameter 逐段 URL 编码。其他值在发 HTTP 前失败。SSE Operation event 会被有界解析为 `{ items, nextCursor? }`，便于不支持原始 SSE 的 Agent 客户端对账。

## 推荐调用流程

### 查询

`data_catalog_search` 支持 `includeTotal: true`，取得不受 `first` 和当前页游标影响的已授权筛选总数 `totalCount`。覆盖统计和结果摘要应使用它，不能把一页大小当成总数，也不需要遍历全部分页。Discovery 保留不可变的 1.0 schema，并公布 1.1。

1. 用 `data_catalog_search` 获取已授权 DataItem 和 cursor；
2. 用 `data_catalog_get`/`data_catalog_version_get` 固定不可变 `versionId`；
3. 查询精确或历史地图时，把该单数 `versionId` 传给 `data_geo_query`；其他情况按需选择 `data_query`、`data_search_federated`、`data_knowledge_search`、graph 或 geo Tool；
4. 检查每个结果的 `versionId`、`evidenceId`、security、quality、acceptance 与 limitations；
5. 不把搜索 score 当作质量或授权结论。

`data_geo_query` 接受一个可选的 `versionId`。省略时，从每个 DataItem 的最新可见且已提交版本选择 extent；指定时则从该精确不可变版本选择 extent。每次响应受 `first` 限制，并以绑定 snapshot/query/scope 的不透明 `nextCursor` 继续；`dataItemIds` 与两种选择均取交集，版本不可见或不存在时返回空结果集。

`data_geo_intersect` 先把 DataItem target 解析为可见已提交 Version，再收集全部 sibling extent，绝不回退旧 Version。当前 catalog/version Tool 输出必须带有 `tileAvailability`；Agent 可用布尔量决定是否提供受控 vector/raster route，但不得由此推断上游服务健康或 COG 合规。

### 入库

`data_ingestion_create` 从共享 Registry 发现可选的 `sourceRegistration` 1.1 输入，用精确来源清单登记真实提供方、目录、接口和研究原始资产。必须保留样本、部分下载、空文件与未知状态；登记成功不表示分析数据完整。Skill 的 `references/water-bundle.md` 说明本机清点与准备流程。原生 OAuth MCP 模式见后端开发文档，上述静态配置保留为兼容模式。

1. `data_upload_session_create` 生成 quarantine 上传计划；
2. 调用方在 MCP 外使用受控预签名 URL 上传大文件；
3. `data_upload_session_complete` 核对对象；
4. `data_ingestion_create` 后 `data_ingestion_submit`；
5. 轮询 `data_operation_get`/`data_operation_events`；
6. 只有具备 `data.publish` 的 steward 在 `WAITING_REVIEW` 使用 approve/reject；
7. 状态到 `SUCCEEDED`/`PUBLISHED` 后再查询固定版本。

长任务 Tool 返回共享 `operationId`，不会在 MCP 请求中等待整个入库或投影过程。Gateway 从顶层或嵌套 `operation.operationId` 派生同一个 `operation://` URI，并把它放在成功结果的顶层 `structuredContent.resource`，便于跨 Tool/Resource 恢复。

## Resources

Gateway 注册五类模板；每次读取都通过同一个 Data API bearer、Tenant、Project 与 Purpose 重新授权：

| URI template                                       | 内容                                   |
| -------------------------------------------------- | -------------------------------------- |
| `data://items/{dataItemId}/versions/{versionId}`   | 精确不可变 DataItemVersion             |
| `evidence://fragments/{evidenceId}`                | 受授权的证据片段                       |
| `operation://{operationId}`                        | Operation 当前状态                     |
| `schema://capabilities/{capabilityId}/{version}`   | 固定 Capability schema/mapping         |
| `stac://collections/{collectionId}/items/{itemId}` | 受授权 STAC Item 与治理后的 asset href |

Capability Registry 只列出各操作的当前版本；带版本的 `schema://` Resource 是不可变归档，发布兼容的新 schema 不会删除或改写旧 URI。

URI segment 只接受安全字母数字与 `._:-`，不允许斜线、遍历、query 或 credential。Evidence 与 STAC Resource 分别经真实 `/evidence/fragments/:evidenceId` 和 `/stac/collections/:collectionId/items/:itemId` GET 重新执行 Scope、RLS、权威复核与 audit；STAC asset 只指向短期授权下载路由。Resource 返回 `application/json`；无效引用或下游不可用使用安全错误对象，不回显内部 HTTP/数据库正文。

## 响应与上限

成功结果同时提供：

- 中文优先的 `content`，包含紧凑 `MACHINE_DATA`；
- 同一份机器可读 `structuredContent = { ok: true, data, resource? }`；存在合法 Operation ID 时，`resource` 精确为 `operation://<uuid>`。

完整 MCP 结果超过 32,000 字符时返回 `MCP_RESPONSE_TOO_LARGE`，不截断后伪装成完整事实。收窄 `first`、filter 或 cursor。下游 HTTP 正文最大 1 MiB，单个 SSE snapshot 最多 10,000 events，并受每次请求 timeout 保护。

适配器不会把 Data API 的内部 `details`、Bearer 或后端正文转发给 Agent。Tool 调用保留两类可安全行动的身份语义：

| 下游 HTTP | `structuredContent.error.code` | 安全恢复动作                                                        |
| --------- | ------------------------------ | ------------------------------------------------------------------- |
| `401`     | `NOT_AUTHENTICATED`            | 刷新或重新配置短期 Data API credential                              |
| `403`     | `NOT_AUTHORIZED`               | 核对 Tenant、Project、Purpose、Scope 与安全等级；不能靠重试扩大权限 |

其他网络、5xx、契约和未分类失败统一为不泄密的 `DATA_API_ERROR`：

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

这一区分只保留身份类别，不传递 API `details`、资源存在性或 Scope 内部清单。MCP Resource 读取仍把下游失败收敛为安全 `DATA_RESOURCE_UNAVAILABLE`，避免通过 Resource error surface 推断隐藏资源。

## 安全重试

Query 用相同 cursor/filters 重试。Command 只能用相同 principal、Tenant、Project、Purpose、Tool、arguments 与 `idempotencyKey` 重试；版本化 command 的 `expectedVersion` 也必须不变。模糊失败后用 `data_operation_get` 或最小 catalog/ingestion GET 对账，不生成新 key 盲目重复。

MCP 不替调用方保存 bearer、upload id、multipart ETag 或 Operation cursor。调用方负责把这些状态保存在受保护、可恢复且不会进入 Agent 可见正文的位置。

## 共享探索

`data_explore_query` 通过 `POST /api/data/v1/explore/query` 调用 `data.explore.query`。首次使用 `{"spec":{"text":"water"},"view":"resources","first":20}`，续查引用返回的 `queryId`，将 `nextCursor` 传入 `after`。API 固定已发布版本，清单有效期最长 30 分钟，每次调用重新授权所属用户和上下文。MCP Gateway 不访问结果集数据库。`NOT_PARSED` 和空分析数量表示登记就绪情况，不能用来推断没有观测数据。

`data.analysis.create` 接收已发布的 `dataItemId` / `versionId` 和幂等键，原子创建带审计的操作与持久化分析任务，不改变来源登记与质量声明。REST：`POST /api/data/v1/analyses`；GraphQL：`createDataAnalysis(input: JSON!)`；MCP：`data_analysis_create`。需要 `data.ingestion.write` 与 `data.catalog.read` 权限；通过返回的操作 ID 查询进度。

探索契约 1.1 将已完成的分析批次与已发布版本共同固定。`view: "records"` 必须提供 `queryId` 和 `versionId`，返回逐资产字段定义、稳定的记录/要素 ID 及有界分页。`view: "map"` 复用同一结果集，支持可选的 WGS84 `[west,south,east,north]` 范围。游标绑定视图与过滤条件。要纳入原查询之后完成的分析，需要重新运行查询条件。数量表示已索引记录，资源就绪状态与覆盖信息同时披露未解析来源。

探索契约 1.2 在同一授权清单上增加 `view: "graph"`。可选 `versionId` 缩小资源图范围；`recordId` 还要求该版本及其固定分析批次中的记录。资源、版本、文件和证据节点具有明确类型，关系表示权威包含关系；聚焦记录与表格、地图共用身份，文件节点保留来源哈希。这一溯源视图不推断科学关系。每页最多包含 100 个版本、200 个文件和 100 个证据片段；`truncated` 披露省略节点，`nextCursor` 翻阅后续版本，改变聚焦条件不能复用游标。此前 1.0 与 1.1 的契约定义保留在归档中。

探索契约 1.3 在 `QuerySpec` 中增加提供机构完整名称、登记类型以及内容/空间就绪状态筛选。汇总统计整个已授权且固定版本的结果集，与当前资源页分别显示。分析完成但没有内容资产时为 `METADATA_ONLY`；已解析的空内容为 `EMPTY`；已解析内容没有验证几何时为 `NO_SPATIAL_DATA`，坐标系未知或无法可靠转换时为 `CRS_UNVERIFIED`。无效、受限或不支持的未解析内容保留未知数量；物理格式伴随文件不能证明分析内容可用。已索引内容记录包括来源的多种表示、文档和压缩包记录，不表示已去重的科学观测。契约归档中的 1.0–1.2 定义保持不变。

探索契约 1.4 允许在 `view: "records"` 中同时提供 `queryId`、`versionId` 和 `recordId`，从固定分析批次回查一条明确记录。API 自动定位所属文件；若明确指定的文件不匹配，或记录不属于该查询，则返回未找到。单记录回查不能附带续页游标。资源、记录分页、地图和图谱仍绑定版本范围，1.3 契约保留在归档中。

探索契约 1.5 增加可选的地图整体 `spatial.bounds`（WGS84；空结果为 null）及 `mercatorFeatureCount`，由同一授权记录集合计算，不受分页影响。浏览器只请求一条初始记录与范围摘要，定位整个结果范围，再按视口加载同源查询瓦片。点选单要素通过 1.4 的精确记录回查获取详情，点选聚合点继续放大。地图分别标明视口要素／聚合点数与可上图记录总数。追加迁移 `0015_exploration_tile_boundaries.sql` 明确接缝点的唯一瓦片归属，防止重复计数。1.4 契约仍保留在归档中。

探索 1.6 通过同一能力传递严格文件级 `recordQuery`：一个显式版本、经来源字段模式校验的类型化条件、稳定字段排序和列选择。记录、地图瓦片与图谱记录回查共享不可变条件；边界及空值／数值语义见 Data REST。

探索 1.7 增加 `view: "aggregate"`，使用已有 `queryId`、`versionId` 和 `aggregate` 来源配置。文本分组或正数宽度的数值分桶支持计数、求和、均值、最小值与最大值。分组、数值及可选单位字段均校验固定来源模式；不同单位分别统计且不换算。聚合前应用既有记录条件与授权。有效、缺失和无效数值数量可以对账；计数包含所有匹配记录。十进制结果保留为字符串，数值桶返回精确上界；最多返回 200 个分组，并明确完整分组／记录数量及截断状态。空分组／单位标签包含缺失、非标量及超过 4096 字符的标签，无效数值分组也归入空桶；未知单位仍标为未注明。Web 统计页提供字段表单、图表和精确值表格，点击可表达为条件的分组生成共享记录查询。数值图表近似显示有限十进制值，表格保留精确计算值。1.6 发现模式保持不可变。

记录页将 `first` 视为条数上限，同时实施保守的 3 MiB 响应预算。PostgreSQL 先计算有序候选前缀的大小，再返回完整原始内容；选择列时先投影再计量。游标按实际返回条数推进，因字节预算缩小的页不会跳过或重复记录。预算预留元数据与查询配置开销，单条记录仍无法容纳时明确失败，不截断字段。记录视图仅返回用于身份判断的几何存在状态，完整地图几何仍由地图表示提供。

探索协议 1.8 增加时间条件、时间排序，以及小时、日、月、年聚合。源格式为 `iso-offset`、`dmy-local` 或 `ymd-local`；`utcOffsetMinutes` 必须明确填写 −840 至 840 的固定偏移，不推断时区或夏令时。ISO 源值使用自身偏移；无偏移的源时间使用配置偏移，该偏移同时定义日历分组。无效日期归入无法分组，不自动修正。边界使用最多六位小数的 UTC 字符串，范围采用包含起点的 `gte` 和不包含终点的 `lt`，源字符串保持不变。浏览器支持时间折线、完整时间段刷选和等价的键盘范围控件，不同单位使用独立序列。所有视图及 MVT 复用相同条件。1.7 发现协议保持不可变。

探索协议 1.9 支持新 `spec` 同时携带 `baseQueryId`。服务端先重新授权当前用户的完整基础查询，再创建新查询；匹配范围限定为基础查询已固定的版本，并保留各版本的解析批次 ID（含未解析的空值）。显式版本不能扩展到基础范围外。基础查询过期、无权访问或权限撤销时明确失败，不静默切换至新解析批次。Web 记录条件与图表选择使用此细化路径；普通新搜索仍解析当前可访问版本。1.8 发现协议保持不变。
