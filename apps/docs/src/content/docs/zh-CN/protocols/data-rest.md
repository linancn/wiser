---
title: Data REST API
description: Data Foundation 37 项 Capability、OpenAPI、受控 Resource、幂等、SSE 与资产下载协议。
docType: protocol-reference
scope: data-rest-api
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 实现或调用 Data Foundation REST API 时
whenToUpdate:
  - Capability、路由、Header、身份、幂等、版本或错误语义变化时
checkPaths:
  - packages/data-contracts/src/capability/**
  - apps/api/src/data-foundation/**
  - skills/wiser-data-foundation/**
lastReviewedAt: 2026-09-09
lastReviewedCommit: a67f905d4afbb2008494f5ebd7a50fd21953bd99
---

## 协议边界

Data REST 位于现有 Fastify 进程的 `/api/data/v1`，不是第二个服务。33 项业务路由全部调用同一个 `DataCapabilityHandler`；它以 `@wiser/data-contracts` 的 strict Zod 4 schema 校验输入/输出，再执行实时 Scope、安全等级、Purpose、timeout、幂等和 hash-only audit。

MCP、Skill 和 Web 的服务端 DAL 都通过这个 HTTP 边界工作。任何客户端都不能提交 SQL、Cypher、OpenSearch DSL、shell 命令或任意对象存储 key。

## 发现与健康

以下只读发现接口不要求身份，均禁止缓存：

| 方法  | 路径                                               | 结果                                                          |
| ----- | -------------------------------------------------- | ------------------------------------------------------------- |
| `GET` | `/api/data/v1/health`                              | data-postgres、对象存储、Worker readiness；任一缺失返回 `503` |
| `GET` | `/api/data/v1/capabilities`                        | 有序 33 项 Registry 与 draft-7 输入/输出 Schema、四种 mapping |
| `GET` | `/api/data/v1/capabilities/:capabilityId/:version` | 一个固定版本的完整 Capability；未知版本返回 `404`             |

健康成功的核心形状：

```json
{
  "status": "ready",
  "system": "data-foundation",
  "authority": { "database": true, "objectStore": true },
  "worker": true,
  "projections": "rebuildable"
}
```

`projections: rebuildable` 表示投影不是授权权威，并不表示可在响应中忽略 Tenant/Project/security filter。

## OpenAPI 契约投影

共享 `GET /openapi.json` 返回 OpenAPI 3.1 文档，标题固定为 **WISER Platform API**，同时覆盖 Platform、Agent EXCON 与 Data Foundation。Data 的 37 项 Capability 不维护第二份手写 Schema：Fastify 在注册路由时直接把 Registry 的 Zod 4 输入/输出转换成 draft-7 JSON Schema，再按 path、query、body 与 required Header 投影为 OpenAPI operation。

每个 Data operation 都带 `data-foundation` tag、稳定 `operationId`、`bearerAuth`、成功状态的响应 Schema，以及 command 的 `Idempotency-Key` 和版本化 command 的 `If-Match`。Fastify 的 schema compiler 在这里服务于 OpenAPI 投影；运行时唯一业务门禁仍是同一 `DataCapabilityHandler` 的 strict Zod 输入/输出校验，不能让生成文档变成第二个行为来源。

受控 OGC/STAC/vector/raster 代理不是 Capability Registry 条目，因此使用显式、路由专属的 Fastify OpenAPI Schema：身份 Header、path/query allowlist、binary/content type 与稳定 401/403/404/413/422/502/503 error 都进入同一文档；POST/PUT/PATCH/DELETE 的 405 guard 隐藏，不伪装成业务操作。

## 身份与上下文 Header

除发现接口外，每个请求都必须携带：

```http
Authorization: Bearer <supabase-jwt-or-wdc1-delegated-credential>
X-Wiser-Tenant-Id: <tenant-uuid>
X-Wiser-Project-Id: <project-uuid>
X-Wiser-Purpose: <bounded-purpose>
Accept: application/json
```

JWT 或委托凭据只证明入口身份。API 每次都从 Supabase 控制面重新解析 Membership、Role、Scope、L0–L3 ceiling 和 authz version，再把精确上下文设置进短 data-postgres RLS transaction。Header 中的 Tenant/Project 不会自行扩大权限。

每个 command 还要求 UUID：

```http
Idempotency-Key: <uuid>
```

以下版本化 command 还要求强 ETag：

```http
If-Match: "v3"
```

适用范围是 upload Session complete、ingestion submit/approve/reject 与 Operation cancel。Header 与 body 中已有的 `expectedVersion` 必须一致。成功响应在能找到聚合版本时返回 `ETag: "vN"`。所有身份、业务与错误响应使用 `private, no-store`。

## 37 项 Capability 路由

| Capability                    | 方法与路径                                                | 成功               |
| ----------------------------- | --------------------------------------------------------- | ------------------ |
| `data.catalog.search`         | `GET /catalog/data-items`                                 | `200`              |
| `data.catalog.get`            | `GET /catalog/data-items/:dataItemId`                     | `200`              |
| `data.query`                  | `POST /query`                                             | `200`              |
| `data.search.federated`       | `POST /search`                                            | `200`              |
| `data.knowledge.search`       | `POST /knowledge/search`                                  | `200`              |
| `data.graph.expand`           | `POST /graph/expand`                                      | `200`              |
| `data.graph.findPath`         | `POST /graph/find-path`                                   | `200`              |
| `data.geo.query`              | `POST /geo/query`                                         | `200`              |
| `data.geo.intersect`          | `POST /geo/intersect`                                     | `200`              |
| `data.ingestion.create`       | `POST /ingestions`                                        | `202`              |
| `data.ingestion.submit`       | `POST /ingestions/:ingestionId/submit`                    | `202`              |
| `data.operation.get`          | `GET /operations/:operationId`                            | `200`              |
| `data.catalog.create`         | `POST /catalog/data-items`                                | `201`              |
| `data.catalog.versions.list`  | `GET /catalog/data-items/:dataItemId/versions`            | `200`              |
| `data.catalog.versions.get`   | `GET /catalog/data-items/:dataItemId/versions/:versionId` | `200`              |
| `data.uploadSession.create`   | `POST /upload-sessions`                                   | `201`              |
| `data.uploadSession.complete` | `POST /upload-sessions/:uploadSessionId/complete`         | `200`              |
| `data.ingestion.get`          | `GET /ingestions/:ingestionId`                            | `200`              |
| `data.ingestion.approve`      | `POST /ingestions/:ingestionId/approve`                   | `202`              |
| `data.ingestion.reject`       | `POST /ingestions/:ingestionId/reject`                    | `200`              |
| `data.operation.cancel`       | `POST /operations/:operationId/cancel`                    | `200`              |
| `data.operation.events`       | `GET /operations/:operationId/events`                     | `200` SSE snapshot |

表中路径相对于 `/api/data/v1`。准确输入、输出、Scope 与 timeout 必须从 discovery schema 获取，不能复制旧客户端类型代替运行时契约。

## 游标、查询和上限

目录查询 1.1 接受 `includeTotal=true`，返回可选的 `totalCount`，表示分页前调用方可见且符合筛选的完整数量。计数与当前页在同一个短 PostgreSQL repeatable-read 事务中使用相同 RLS 上下文和筛选。后续页是新的请求，不代表跨请求快照。不需要计数时省略此参数；1.0 discovery schema 在归档中保持不可变。

列表使用 `first` 与不透明 `after`。GET 数组参数使用逗号分隔，例如 `qualityGrades=A,B`；API 会拒绝重复 path/query/body 字段、prototype key、无界数字或无效数组。Cursor 与 Tenant/Project、Scope/filter 和授权版本绑定，不能跨上下文复用。

结构化查询只接受 allowlist 字段与 operator：

- `data.query`：受控字段、`EQ/NE/GT/GTE/LT/LTE/IN/CONTAINS` filter；
- graph：实体 ID、关系类型和最大深度；
- `data.geo.query`：受支持 GeoJSON geometry、显式 CRS、`INTERSECTS/WITHIN/CONTAINS/NEAREST` 与可选的单数 `versionId`。省略 `versionId` 时，每个有界响应从各 DataItem 的最新可见且已提交版本选择 extent；指定时则从该精确不可变版本选择 extent。使用返回的、绑定 snapshot/query/scope 的不透明 `nextCursor` 继续；`dataItemIds` 与两种选择均取交集，版本不可见或不存在时返回空结果集；
- `data.geo.intersect`：接受 Geometry 或 DataItem target；DataItem target 先选择最新/精确的可见已提交 Version，再收集全部 sibling extent，绝不回退旧 Version。target 缺失、不可见、无 extent 或彼此不相交时均返回不可区分的空页，并使用同样的 snapshot/query/scope cursor 继续；
- federated search：catalog/fulltext/semantic/graph/geo/stac source allowlist。

`data.query` 读取所选已提交版本的结构化证据记录。可见的来源登记版本尚无分析记录时，返回 `200`、精确的 `versionId`、请求的列和 `rows: []`；通过目录、证据检索和受控文件下载查看来源材料。空结果不代表原始文件丢失。JSON 相等与包含筛选比较完整提取的 JSON 操作数；真实 PostgreSQL 集成覆盖全部八种运算符、空记录和安全/策略过滤。

当前 catalog get/version 响应要求 `tileAvailability: { vector, raster }`。它描述受控 source 是否可路由，不表示 GIS 服务健康：vector 要求可见的版本级 extent；raster 要求可见 RAW TIFF/GeoTIFF asset 具备 blob/hash/input 关联和精确内容寻址 key。

SearchOrchestrator 在后端下推权限与发布过滤，固定 `RRF k=60`，按 DataItem+Version 去重，再逐条重新授权。

图谱展开包含可见的孤立种子。合法查询没有可见匹配时返回空 `nodes`/`edges`，不作为依赖失败。适配器按实体与边的身份合并全部有界路径行，拒绝内容冲突的重复身份，并对节点和关系同时过滤租户、项目、安全等级、策略、验收与发布状态；不会创建投影中不存在的关系。

## 受控 GIS 代理

GeoServer、STAC API、TiTiler 与 Martin 没有宿主 published port；浏览器、Agent 和外部客户端唯一允许的 GIS 入口是下列 Fastify GET/HEAD：

| 表面     | 受控路由                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------- |
| OGC      | `/api/data/v1/geo/ogc/{wms,wfs,wcs,wmts}`                                                       |
| STAC     | `/api/data/v1/geo/stac`、`/conformance`、`/search`、`/collections/current[/items[/wiser-…]]`    |
| 矢量瓦片 | `/api/data/v1/geo/tiles/vector/versions/{versionId}/{z}/{x}/{y}.pbf`                            |
| 栅格瓦片 | `/api/data/v1/geo/tiles/raster/versions/{versionId}/WebMercatorQuad/{z}/{x}/{y}.{png,jpg,webp}` |

每次调用都要求统一 Bearer、Tenant、Project、Purpose 与 `data.geo.read`；其他 HTTP 方法返回 `405`。OGC 只接受每个 service 的只读 request/query allowlist；除 GetCapabilities 外，调用方必须给出授权的 `versionId`，API 固定 layer/type 与 Tenant/Project/Version filter。STAC 的 `current` 自动替换为当前 Tenant/Project 的确定性 collection，跨 scope collection 返回安全 `404`。

矢量瓦片先在 data-postgres RLS 下确认该 Version 有可见 spatial extent，再调用 Martin 按版本限定的 `service.wiser_spatial_extent_mvt` source；Tenant、Project、Version、安全 ceiling 与 policy version 均由服务端注入。栅格瓦片只从权威表的可见 RAW asset 中选择 TIFF/GeoTIFF COG，再由服务端验证内容寻址 key 并生成受限 `s3://` source 给 TiTiler；客户端提交 `url`/source 会在任何上游 I/O 前返回 `422`。

四个上游 origin 来自启动时校验的内部配置，禁止 userinfo/query/fragment、redirect 与动态 host。代理 query、tile coordinate、TMS、format、content type 均为严格 allowlist；默认 timeout 5 秒、响应上限 8 MiB，并只转发安全 ETag/Last-Modified。每次 ALLOWED/DENIED/FAILED 记录 `data.geo.read`、目标与 route hash；未认证拒绝只记录脱敏平台日志，不能伪造 actor audit。

MapLibre 不把 API Bearer 放进 tile URL。登录后的浏览器只请求同源 `/api/data-foundation/geo/...`；Next Route Handler 重新验证 Supabase Session，以 server-only access token 和固定 Tenant/Project/Purpose 转发上述 Fastify 路由，同时再次限制 path/query/content/response size。该 Web 路径不是第二套 GIS 业务逻辑。

权威授权通过后，只有 TiTiler PNG 返回坐标与当前请求完全一致的越界响应（`404` JSON 且仅含 `detail: Tile(x=…, y=…, z=…) is outside bounds`）才转换为透明的 256 像素 PNG。资产缺失、权限拒绝、格式异常及其他错误仍然失败。正常 HEAD 保持 HEAD；只有 PNG HEAD 的越界候选响应才在同一超时和正文上限内补取一次 GET。响应继续审计并使用 `no-store`。

## 上传与入库

`data.ingestion.create` 1.1 接受可选 `sourceRegistration`，ingestion get/reject 1.1 保留该描述；1.0 schema 仍可从不可变发现归档读取。完整严格字段以 discovery 为准，包含来源/数据包身份、类型、名称、提供方、访问状态、明确的完整性、限制说明以及 `manifestAssetId` / `manifestSha256`。清单资产必须属于本次入库引用的已完成上传资产。

清单使用 `wiser.source-registration.v1`，包含一致的 `sourceId`、来源 `record` 和 `files`。每个非空文件以 `assetId` 绑定原始/准备后大小与 SHA-256、相对路径、材料类别、完整性、处理方式和关联来源 ID。空文件要求大小为零且哈希等于空内容哈希。清单最多 512 KiB、1,000 个文件条目。来源登记的发布保留原始文件和声明元数据，不证明分析可用性；不可变版本和检索限制均保留这一区分。

推荐流程：

1. `POST /upload-sessions`，声明文件名、media type、size、可选 SHA-256 与 `PRESIGNED_PUT`/`MULTIPART` 偏好；
2. 只使用响应返回的 URL、Header、不透明 upload id 和连续 part number 上传到 quarantine；
3. `POST /upload-sessions/:id/complete`，带同一幂等键语义与 `If-Match`，提交 size/hash/ETag；
4. `POST /ingestions`，引用完成后的 asset IDs；
5. `POST /ingestions/:id/submit`，Worker 开始持久任务；
6. 查询 Operation/SSE，状态到 `WAITING_REVIEW` 时由具备 `data.publish` 的 steward approve 或 reject；
7. 五个 completion target ledger 成功后状态进入 `PUBLISHED`。

URL 的 TTL 是 60–900 秒；调用方不能改 key。API 在完成前通过 HEAD 验证对象完整性，正式 raw/version 对象以内容 hash 寻址且不可覆盖。

## Operation SSE

`GET /operations/:operationId/events?after=<cursor>&first=<n>` 返回一个有界 `text/event-stream` snapshot，而不是无限保持的连接。每个 event 有稳定 `id`、`event` 和 JSON `data` 行；更多数据时响应 Header 包含 `X-Next-Cursor`。

断线后使用最后确认的 cursor 重新请求。不要用 wall-clock 或进度百分比合成事件，也不要把重复 event 当作新的状态转换。

Publication consumer 尊重 Operation 终态：即使五个 completion target 已经 `SUCCEEDED`，若 Operation 已是 `FAILED`/`CANCELLED`，也不会改回成功或发布版本；它记录 `PUBLICATION_OPERATION_TERMINAL` 到 consumer checkpoint 并推进 poison event，后续成功 event 再清除摘要。原 Operation event、Job 与 target 证据不被覆盖。

## Evidence 与 STAC Resource 读取

以下两条受控 GET 不属于 33 项业务 Capability；它们专门承载 MCP Resource，并仍复用统一 Auth、data-postgres RLS、授权后审计与 no-store：

| 路径                                                        | Scope                 | 权威与输出边界                                                                                                                 |
| ----------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `/api/data/v1/evidence/fragments/:evidenceId`               | `data.knowledge.read` | `evidenceId` 必须是 UUID；只返回调用方可见且关联已提交版本的 Evidence、locator/hash、可选 excerpt、安全/策略/版本元数据        |
| `/api/data/v1/stac/collections/:collectionId/items/:itemId` | `data.geo.read`       | collection 必须是当前 Tenant/Project 的确定性 `wiser-<32 hex>`；item 为 `wiser-<48 hex>`；只返回经权威版本复核的 STAC 1.1 Item |

Evidence 事务同时对 fragment 与其 DataItemVersion 执行 `security.authorized_row`，把 `data.evidence.read` 和引用 hash 写入 append-only audit；隐藏与不存在使用同一 `404`。STAC 路由先拒绝跨 Tenant/Project collection，再从固定内部 STAC origin 有界读取，剥离上游 link/未知字段，并逐项核对 DataItem、Version、Evidence、source hash、安全等级、policy、质量、验收与 `PUBLISHED` 状态。其 source asset href 必须精确指向下述受控下载入口；成功读取追加 `data.stac-item.read` audit。

两个 Resource 响应最大 256 KiB，均为 `application/json` 和 `private, no-store`。引用非法返回 `422`，输出过大返回 `413`，上游投影契约不合法返回 `502`，依赖不可用返回 `503`；数据库、内部 STAC bearer、上游 URL 和原始错误正文永不回显。

## 授权资产下载

多文件版本可将下述路径末尾的 `source` 替换为版本返回的精确 `assetId`。API 将资产绑定到指定可见版本，并对资产和版本都复核 RLS。路径 Tenant/Project 必须在查询和签名前与已认证的 Header 上下文一致。`source` 保留为首个有序资产的兼容别名；隐藏或不属于该版本的资产返回 `404`。

已发布 STAC Item 的 source asset 使用：

```text
GET /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/source
```

调用方仍需完整身份 Header 和 `data.catalog.read`。路径 Tenant/Project 必须等于授权上下文。API 在 RLS transaction 内选择一个 RAW asset、追加允许审计，然后返回 `303` 和：

```http
Location: <60-second-presigned-url>
X-Signed-Url-Expires-At: <rfc3339>
```

不存在或不可见均使用安全 `404`；对象存储 credential 和内部 key 解析错误不会进入响应。

## 调用示例

```bash
curl --fail http://127.0.0.1:3101/api/data/v1/health

curl --fail \
  -H "Authorization: Bearer $DATA_API_BEARER_TOKEN" \
  -H "X-Wiser-Tenant-Id: $DATA_TENANT_ID" \
  -H "X-Wiser-Project-Id: $DATA_PROJECT_ID" \
  -H "X-Wiser-Purpose: data-steward-console" \
  'http://127.0.0.1:3101/api/data/v1/catalog/data-items?first=20&qualityGrades=A,B'
```

写请求必须再加 `Content-Type: application/json` 与 UUID `Idempotency-Key`。不要在日志、命令历史、Message 或 Artifact 中持久化真实 bearer。

## 错误与安全重试

Data REST 错误是扁平安全 envelope：

```json
{
  "code": "CONFLICT",
  "message": "资源状态或版本已发生变化。 / The resource state or version has changed.",
  "traceId": "<32-hex>"
}
```

| HTTP  | 含义                                                |
| ----- | --------------------------------------------------- |
| `401` | bearer 或 Tenant/Project/Purpose 上下文缺失/无效    |
| `403` | 已知身份缺少 Scope、security ceiling 或资源权限     |
| `404` | 资源不存在或调用方无权知道其存在                    |
| `405` | GIS 代理收到非 GET/HEAD 方法                        |
| `413` | 受控 Resource 超过 256 KiB 响应上限                 |
| `409` | 状态、版本、内容不可变或幂等冲突                    |
| `422` | strict schema、Header 或领域前置条件失败            |
| `502` | 上游 Resource/投影响应不符合受控契约                |
| `503` | authority、Worker 或 projection dependency 暂不可用 |
| `500` | 服务端契约/配置失败；响应仍不泄露内部详情           |

模糊失败只能以完全相同的 actor、Tenant、Project、Purpose、method、path、body、`Idempotency-Key` 和 `If-Match` 重试。同 key/同 canonical hash 返回原结果；同 key/不同 hash 返回冲突。随后通过最小 GET 或 Operation event 对账。

## 共享探索结果集

`POST /api/data/v1/explore/query` 调用 `data.explore.query`，同时要求 `data.query.execute` 与 `data.catalog.read`。首次使用 `{"spec":{"text":"water"},"view":"resources","first":20}`；续查使用 `{"queryId":"<返回的 UUID>","view":"resources","first":20,"after":"<返回的游标>"}`。`spec` 与 `queryId` 必须二选一，续页必须引用已有结果集。响应包含 `queryId`、`spec`、建立和过期时间、授权范围内的 `totalCount`、固定版本的 `resources`、就绪状态及可选 `nextCursor`。

清单有效期为 30 分钟。其他用户、Purpose/安全上限/授权版本变化以及过期 ID 返回 `404`；权威成员可见性变化返回 `409`；无效条件/游标或匹配超过 10,000 个版本返回 `422`。同一匹配的用户与上下文最多保留 32 个近期清单，新查询可能淘汰更早的结果集；失效后重新执行原查询条件。投影就绪状态可独立推进。接口不接受 SQL、Cypher 或租户、Actor 覆盖字段。

`data.analysis.create` 接收已发布的 `dataItemId` / `versionId` 和幂等键，原子创建带审计的操作与持久化分析任务，不改变来源登记与质量声明。REST：`POST /api/data/v1/analyses`；GraphQL：`createDataAnalysis(input: JSON!)`；MCP：`data_analysis_create`。需要 `data.ingestion.write` 与 `data.catalog.read` 权限；通过返回的操作 ID 查询进度。

探索契约 1.1 将已完成的分析批次与已发布版本共同固定。`view: "records"` 必须提供 `queryId` 和 `versionId`，返回逐资产字段定义、稳定的记录/要素 ID 及有界分页。`view: "map"` 复用同一结果集，支持可选的 WGS84 `[west,south,east,north]` 范围。游标绑定视图与过滤条件。要纳入原查询之后完成的分析，需要重新运行查询条件。数量表示已索引记录，资源就绪状态与覆盖信息同时披露未解析来源。

探索契约 1.2 在同一授权清单上增加 `view: "graph"`。可选 `versionId` 缩小资源图范围；`recordId` 还要求该版本及其固定分析批次中的记录。资源、版本、文件和证据节点具有明确类型，关系表示权威包含关系；聚焦记录与表格、地图共用身份，文件节点保留来源哈希。这一溯源视图不推断科学关系。每页最多包含 100 个版本、200 个文件和 100 个证据片段；`truncated` 披露省略节点，`nextCursor` 翻阅后续版本，改变聚焦条件不能复用游标。此前 1.0 与 1.1 的契约定义保留在归档中。

探索契约 1.3 在 `QuerySpec` 中增加提供机构完整名称、登记类型以及内容/空间就绪状态筛选。汇总统计整个已授权且固定版本的结果集，与当前资源页分别显示。分析完成但没有内容资产时为 `METADATA_ONLY`；已解析的空内容为 `EMPTY`；已解析内容没有验证几何时为 `NO_SPATIAL_DATA`，坐标系未知或无法可靠转换时为 `CRS_UNVERIFIED`。无效、受限或不支持的未解析内容保留未知数量；物理格式伴随文件不能证明分析内容可用。已索引内容记录包括来源的多种表示、文档和压缩包记录，不表示已去重的科学观测。契约归档中的 1.0–1.2 定义保持不变。

探索契约 1.4 允许在 `view: "records"` 中同时提供 `queryId`、`versionId` 和 `recordId`，从固定分析批次回查一条明确记录。API 自动定位所属文件；若明确指定的文件不匹配，或记录不属于该查询，则返回未找到。单记录回查不能附带续页游标。资源、记录分页、地图和图谱仍绑定版本范围，1.3 契约保留在归档中。

查询结果矢量入口为 `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf`，额外要求 `data.query.execute` 与 `data.catalog.read`。每次请求均在 RLS 下重新校验当前用户的查询清单及全部固定版本和分析批次，然后才调用 Martin。调用方不得提交查询参数，七项范围值全部来自已验证上下文和路径。响应使用 `exploration` 图层及 `Cache-Control: no-store`；过期、撤权或属于其他用户的查询不会访问上游。现有按版本瓦片保留原路径和图层。

探索契约 1.5 增加可选的地图整体 `spatial.bounds`（WGS84；空结果为 null）及 `mercatorFeatureCount`，由同一授权记录集合计算，不受分页影响。浏览器只请求一条初始记录与范围摘要，定位整个结果范围，再按视口加载同源查询瓦片。点选单要素通过 1.4 的精确记录回查获取详情，点选聚合点继续放大。地图分别标明视口要素／聚合点数与可上图记录总数。追加迁移 `0015_exploration_tile_boundaries.sql` 明确接缝点的唯一瓦片归属，防止重复计数。1.4 契约仍保留在归档中。

通过授权后的 Martin `204 No Content` 规范化为内容为空的 `200` MVT 响应，使无数据视口正常显示。这一处理仅适用于已授权的 Martin 请求；其他缺失内容类型的响应仍拒绝通过校验。

探索契约 1.6 增加可选的 `spec.recordQuery`，必须绑定一个显式不可变 `versions` 条目和来源 `assetId`。创建查询前，最多八条文本／数值／空值条件、一项字段升降序排序和最多 32 个不重复的选择列均按固定分析文件的字段模式校验。数值转换接受有限十进制及科学计数值，不改写来源标识或原始 JSON；空值和缺失需使用显式存在性条件。记录页、地图摘要、查询瓦片与图谱记录回查执行相同条件，精确回查不能绕过筛选。排序以原始记录序号稳定打破并列。列选择约束返回的记录字段；目录就绪总数仍表示已索引的来源内容，不暗示跨文件单位换算或科学聚合。追加迁移 `0016_exploration_record_queries.sql` 提供共享条件函数并更新瓦片函数，发现服务仍保留不可变的 1.5 契约。

迁移 `0017_exploration_predicate_compilation.sql` 保持类型化比较语义，并将最多八条条件的表达式交给 PostgreSQL 规划。数值转换采用带格式边界的精确 SQL/JSON 数值解析。记录查询在限定文件范围内只计算一次每个类型化字段，物化记录标识与比较值，在同一关系上完成计数和排序分页，最后仅按当前页标识读取原始内容。空值排序及来源序号的稳定并列顺序保持不变。集成测试先对比 187 组旧、新标量条件结果，再验证 RLS、分页和筛选后的瓦片。

探索 1.7 增加 `view: "aggregate"`，使用已有 `queryId`、`versionId` 和 `aggregate` 来源配置。文本分组或正数宽度的数值分桶支持计数、求和、均值、最小值与最大值。分组、数值及可选单位字段均校验固定来源模式；不同单位分别统计且不换算。聚合前应用既有记录条件与授权。有效、缺失和无效数值数量可以对账；计数包含所有匹配记录。十进制结果保留为字符串，数值桶返回精确上界；最多返回 200 个分组，并明确完整分组／记录数量及截断状态。空分组／单位标签包含缺失、非标量及超过 4096 字符的标签，无效数值分组也归入空桶；未知单位仍标为未注明。Web 统计页提供字段表单、图表和精确值表格，点击可表达为条件的分组生成共享记录查询。数值图表近似显示有限十进制值，表格保留精确计算值。1.6 发现模式保持不可变。

记录页将 `first` 视为条数上限，同时实施保守的 3 MiB 响应预算。PostgreSQL 先计算有序候选前缀的大小，再返回完整原始内容；选择列时先投影再计量。游标按实际返回条数推进，因字节预算缩小的页不会跳过或重复记录。预算预留元数据与查询配置开销，单条记录仍无法容纳时明确失败，不截断字段。记录视图仅返回用于身份判断的几何存在状态，完整地图几何仍由地图表示提供。

探索协议 1.8 增加时间条件、时间排序，以及小时、日、月、年聚合。源格式为 `iso-offset`、`dmy-local` 或 `ymd-local`；`utcOffsetMinutes` 必须明确填写 −840 至 840 的固定偏移，不推断时区或夏令时。ISO 源值使用自身偏移；无偏移的源时间使用配置偏移，该偏移同时定义日历分组。无效日期归入无法分组，不自动修正。边界使用最多六位小数的 UTC 字符串，范围采用包含起点的 `gte` 和不包含终点的 `lt`，源字符串保持不变。浏览器支持时间折线、完整时间段刷选和等价的键盘范围控件，不同单位使用独立序列。所有视图及 MVT 复用相同条件。1.7 发现协议保持不可变。

探索协议 1.9 支持新 `spec` 同时携带 `baseQueryId`。服务端先重新授权当前用户的完整基础查询，再创建新查询；匹配范围限定为基础查询已固定的版本，并保留各版本的解析批次 ID（含未解析的空值）。显式版本不能扩展到基础范围外。基础查询过期、无权访问或权限撤销时明确失败，不静默切换至新解析批次。Web 记录条件与图表选择使用此细化路径；普通新搜索仍解析当前可访问版本。1.8 发现协议保持不变。

探索协议 1.10 增加不可变的 `spec.spatialBounds`，按 WGS84 西、南、东、北排列。记录、聚合、图谱记录回查和查询 MVT 在聚合前使用相同的已验证几何相交条件。资源及来源图概览显示匹配版本；来源就绪统计仍表示已索引内容。查询清单保留底层授权范围的版本与批次，使通过 `baseQueryId` 清除或改变范围时不刷新解析结果、不丢失原始范围。即使位于地图范围外，所有固定成员仍需重新授权。地图提供点、线、面显隐、图例、本地字体聚合数量与视口筛选；图层显隐只改变呈现，不改变查询授权或计数。未验证坐标的数据明确排除。1.9 发现协议保持不可变。

探索协议 1.11 增加 `graph.detail`（`assets`、`evidence`、`records`），按固定版本分页展开邻居；记录展开还需指定来源文件。`graph.grain` 标明 `totalCount` 的计数单位。游标绑定焦点、展开类型与关系筛选；记录复用共享条件、固定解析批次及字节预算。`graph.relations` 筛选包含／来源关系。可选 `graph.path` 在关系筛选后的当前返回页内查找最多八条边的有向最短路径；端点不在本页时明确失败，不泄露外部节点。未找到路径只说明本页中没有路径，不代表完整知识库中不存在。1.10 契约保持不可变。

保存视图使用 `data.explore.view.create`、`.list`、`.open` 和 `.revoke`；`data.explore.export` 导出一次有界查询表示。均要求 `data.query.execute` 与 `data.catalog.read`。创建／撤销为同步命令，必须携带 UUID `Idempotency-Key`，并原子写入审计与命令账本。视图保存原 QuerySpec、版本／解析批次，以及类型化 ViewSpec（视图请求、分页历史、选择身份、地图视角与图层），不复制记录正文。每位用户在项目内最多保留 100 个有效视图。默认私人可见；显式项目分享仍需当前登录用户的项目范围、用途与安全级别检查，打开时重新授权每个固定成员。列表仅返回当前用户自己的保存配置。打开时重新签发本人绑定的 30 分钟查询和游标，不解析更新版本或批次；原临时查询到期不影响持久配置。仅创建者可以单向撤销。导出重新授权请求，返回原始值、来源、明确的返回／总量和计数单位；后续页或截断结果不会标成完整。各传输入口不会在 SSR/BFF 内排空所有分页。

| Capability                 | HTTP path (under `/api/data/v1`)     |
| -------------------------- | ------------------------------------ |
| `data.explore.view.create` | `POST /explore/views`                |
| `data.explore.view.list`   | `GET /explore/views`                 |
| `data.explore.view.open`   | `POST /explore/views/:viewId/open`   |
| `data.explore.view.revoke` | `POST /explore/views/:viewId/revoke` |
| `data.explore.export`      | `POST /explore/export`               |

原文件字节通过 `GET/HEAD /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/{assetId}/content` 提供。API 重复既有资产／版本授权和审计，仅为内部存储入口签名，并以两分钟截止和单范围请求支持流式传输，不暴露签名地址。验证当前会话的 Web 入口 `/api/data-foundation/assets/{versionId}/{assetId}` 提供带文件名的附件或白名单内的惰性预览，剥离上游 Cookie，使用 no-store、nosniff 和沙箱内容策略。原文件下载与有界查询页导出相互独立。资源页先显示解析内容，再展示治理信息，保持精确版本与文件身份，提供分页表格、来源文档、结构化内容及地图／图谱联动。嵌套结构按有界分组懒加载，展示标签之外保留原始标签。

高德矢量显示接口在 `/api/data/v1` 下增加 `/geo/tiles/vector/amap/queries/{queryId}/{z}/{x}/{y}.pbf` 和 `/geo/tiles/vector/amap/versions/{versionId}/{z}/{x}/{y}.pbf`，沿用原矢量接口的 scope、不可变查询成员、记录与空间条件、有效期及逐请求鉴权。瓦片已经完成高德显示坐标转换，客户端不得再次偏移；原始记录坐标、分析范围与下载内容仍保持声明的来源或权威坐标系。

## 观测核验

`POST /reconciliations`, `GET /reconciliations?versionId=...`, `GET /reconciliations/{batchId}`, `POST /reconciliations/{batchId}/review` 对应 `data.reconciliation.create/list/get/review`。来源固定、规范化、不可变证据和限额见[副本核验与业务去重](/architecture/data-foundation/#副本关系核验与业务观测去重)。读取需要 `data.query` 和 `data.catalog.read`；创建另需 `data.ingestion.write`，审核另需 `data.publish` 且只能由创建批次的人类身份执行。审核携带 `expectedVersion`；REST 还要求一致的 `If-Match: "v1"`，MCP 将预期版本转为该请求头。两个命令在相同重试中均须保留原 UUID 幂等键。

`get` 接收 `batchId`、`first`（默认 25，最多 100）、可选 `after` 和 `groupIndex`。未指定组号时分页返回观测组摘要；指定时分页返回该组来源成员。使用 `nextCursor` 继续，不得改变绑定的批次、版本和组。`list` 接收 `versionId`，返回本人最近最多 100 批。创建冻结 `left`、`right` 和 `plan`；审核接收 `decision: "verify" | "reject"` 和 `note`。冲突或信息不完整时不能确认；候选的 `independentObservationCount` 为 null，只有人工确认的批次才返回所选规则范围内的计数。Agent 可以提出批次并读取确定性证据，不能以 Agent 身份作最终审核。

## 资料检查接口

`POST /api/data/v1/assessments` 对应 `data.assessment.create`，要求 `data.catalog.read`、`data.ingestion.write` 及 UUID `Idempotency-Key`。传入 `dataItemId`、固定 `versionId`、`assetId` 和严格的 `declaration`，包含预期文件哈希、资料类型、检查对象、取得与访问条件、覆盖范围、依据及可选类型信息。目标必须是已提交且当前可见的 RAW 原件。返回 `{ assessment }`，保留服务器读取的哈希、解析器版本、分析标识、检查时间、声明和确定性发现；过期自查不替代服务器重查。

`GET /api/data/v1/assessments/:assessmentId` 读取单条；`GET /api/data/v1/assessments?dataItemId=…&versionId=…&first=25` 分页读取，通过 `after=nextCursor` 继续，每页最多 100 条，均要求 `data.catalog.read`。读取和同键重试都会重新核对原件权限，来源撤回后不可读取。报告不授予权限、批准发布或认证位置；`REMOTE_QUERY_REPORTED` 保持未独立核验，声明范围完整也不等于已独立测得整个数据集总量。

`GET /api/data/v1/assessments/overview` 对应 `data.assessment.overview`，要求 `data.catalog.read` 和明确的检查对象，可传入 `query`、`action`、`first`（1–100）及不透明 `after` 游标。总数、已记录数、未核查数和下一步计数共用完整授权范围的资料分母；`selectedCount` 是当前下一步条件的资料数，不是本页数量。明细固定资料/版本并保留最近适用报告的时间。没有检查就是 `UNCHECKED`，不表示不可取得。
