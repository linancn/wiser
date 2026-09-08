---
title: Data REST API
description: Data Foundation 22 项 Capability、OpenAPI、受控 Resource、幂等、SSE 与资产下载协议。
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
lastReviewedAt: 2026-09-08
lastReviewedCommit: 25eee01796818498b02abd32f773c580ffb75f32
---

## 协议边界

Data REST 位于现有 Fastify 进程的 `/api/data/v1`，不是第二个服务。22 项业务路由全部调用同一个 `DataCapabilityHandler`；它以 `@wiser/data-contracts` 的 strict Zod 4 schema 校验输入/输出，再执行实时 Scope、安全等级、Purpose、timeout、幂等和 hash-only audit。

MCP、Skill 和 Web 的服务端 DAL 都通过这个 HTTP 边界工作。任何客户端都不能提交 SQL、Cypher、OpenSearch DSL、shell 命令或任意对象存储 key。

## 发现与健康

以下只读发现接口不要求身份，均禁止缓存：

| 方法  | 路径                                               | 结果                                                          |
| ----- | -------------------------------------------------- | ------------------------------------------------------------- |
| `GET` | `/api/data/v1/health`                              | data-postgres、对象存储、Worker readiness；任一缺失返回 `503` |
| `GET` | `/api/data/v1/capabilities`                        | 有序 22 项 Registry 与 draft-7 输入/输出 Schema、四种 mapping |
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

共享 `GET /openapi.json` 返回 OpenAPI 3.1 文档，标题固定为 **WISER Platform API**，同时覆盖 Platform、Agent EXCON 与 Data Foundation。Data 的 22 项 Capability 不维护第二份手写 Schema：Fastify 在注册路由时直接把 Registry 的 Zod 4 输入/输出转换成 draft-7 JSON Schema，再按 path、query、body 与 required Header 投影为 OpenAPI operation。

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

## 22 项 Capability 路由

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

矢量瓦片先在 data-postgres RLS 下确认该 Version 有可见 spatial extent，再调用 Martin 的唯一 `service.wiser_spatial_extent_mvt` source；Tenant、Project、Version、安全 ceiling 与 policy version 均由服务端注入。栅格瓦片只从权威表的可见 RAW asset 中选择 TIFF/GeoTIFF COG，再由服务端验证内容寻址 key 并生成受限 `s3://` source 给 TiTiler；客户端提交 `url`/source 会在任何上游 I/O 前返回 `422`。

四个上游 origin 来自启动时校验的内部配置，禁止 userinfo/query/fragment、redirect 与动态 host。代理 query、tile coordinate、TMS、format、content type 均为严格 allowlist；默认 timeout 5 秒、响应上限 8 MiB，并只转发安全 ETag/Last-Modified。每次 ALLOWED/DENIED/FAILED 记录 `data.geo.read`、目标与 route hash；未认证拒绝只记录脱敏平台日志，不能伪造 actor audit。

MapLibre 不把 API Bearer 放进 tile URL。登录后的浏览器只请求同源 `/api/data-foundation/geo/...`；Next Route Handler 重新验证 Supabase Session，以 server-only access token 和固定 Tenant/Project/Purpose 转发上述 Fastify 路由，同时再次限制 path/query/content/response size。该 Web 路径不是第二套 GIS 业务逻辑。

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

以下两条受控 GET 不属于 22 项业务 Capability；它们专门承载 MCP Resource，并仍复用统一 Auth、data-postgres RLS、授权后审计与 no-store：

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
