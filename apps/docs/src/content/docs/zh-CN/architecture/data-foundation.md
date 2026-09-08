---
title: 数据基座领域架构
description: Data Foundation 的权威边界、入库纵切、投影、协议与验证合同。
docType: architecture
scope: data-foundation
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 Data Foundation DTO、Capability、状态机、权威数据或发布门禁时
  - 实现或审查 data-postgres、对象存储、Worker、投影、API、MCP、Skill 或 Web 时
whenToUpdate:
  - 公开契约、状态转换、权威源、投影或完成边界变化时
checkPaths:
  - packages/data-*/**
  - apps/data-worker/**
  - apps/api/src/data-foundation/**
  - apps/mcp/src/data-foundation/**
  - apps/web/src/app/*/data-foundation/**
  - infrastructure/data-foundation/**
lastReviewedAt: 2026-09-08
lastReviewedCommit: e1ab9f89b55bb592e42ed5eb164a193ff79eb8dd
---

## 权威边界

Data Foundation 是与 Agent EXCON 平级的 WISER 业务系统。它拥有 DataItem、不可变版本、资产、入库、质量、血缘、知识、检索、GIS、Operation 与投影事实；它不拥有用户 Session、Tenant、Project、Membership、Role 或 Token。Supabase Auth/PostgreSQL 是统一身份与控制面，独立 data-postgres/PostGIS 与 S3 兼容对象存储构成 Data 权威面。

默认 Data runtime 组合：

```text
Supabase principal + Tenant/Project/Purpose
  → Fastify REST / schema-first GraphQL
  → 同一 DataCapabilityHandler（22 项静态 executor）
  → data-postgres RLS transaction / SeaweedFS S3
  → PostgreSQL durable job + Transactional Outbox
  → Data Worker
  → PostGIS spatial readiness（同一 data-postgres）
  → Weaviate / OpenSearch / Neo4j / STAC 可重建外部投影
  → REST / GraphQL / MCP / authenticated Web readback
```

GeoServer、TiTiler 和 Martin 作为 Compose-internal GIS 服务存在于同一个精确锁定 profile，不发布 host port；外部只经过统一 Auth 的 Fastify GIS 代理。Outbox ledger 有五个完成目标。`POSTGIS` 目标在权威 data-postgres 内建立/验证受治理的 `catalog.spatial_extent` 空间表示；其 source/version/spatial authority rows 不能当作可丢弃外部投影。Weaviate、OpenSearch、Neo4j 与 STAC 是可重建外部投影。任何单一 target 都不承担身份、授权、验收或发布决定。

## 包与依赖方向

| 模块                                        | 职责                                                                        |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `@wiser/data-contracts`                     | 严格 Zod DTO、22 项 Capability、四种 transport mapping                      |
| `@wiser/data-core`                          | 纯确定性的入库/Operation 状态机、质量、安全继承和发布门禁                   |
| `@wiser/data-infra`                         | checksum migration、PostgreSQL/S3、任务/Outbox、投影、检索和 fake embedding |
| `@wiser/data-worker`                        | 具体入库 Handler、Scheduler、投影 consumer、健康与指标                      |
| `apps/api`                                  | 统一身份后的 REST/GraphQL composition 与安全下载重定向                      |
| `apps/mcp` / `skills/wiser-data-foundation` | 只经 HTTP 的 Agent 适配层                                                   |
| `apps/web`                                  | server-only DAL 驱动的双语只读治理工作区                                    |

依赖固定为 `platform contracts <- data-contracts <- data-core <- application/infra <- apps`。Core 不导入数据库、HTTP、文件系统、框架、时钟、随机或 AI Provider；时钟、ID 与外部效果全部通过 Port 注入。

## 单一 Capability 契约

`@wiser/data-contracts` 是 REST、GraphQL、MCP、Skill 与 runtime validation 的唯一契约源。公开对象使用 strict Zod 4 schema；未知字段和缺失必填字段均失败。`GET /api/data/v1/capabilities` 返回 draft-7 输入/输出 JSON Schema、Scope、安全上限、执行模式、timeout、audit level 以及精确的四种 transport mapping。

Registry 覆盖 catalog/version、query/search、knowledge/graph、geo、upload/ingestion 与 Operation 生命周期。精确 Capability ID、顺序、版本、Scope 与各 transport mapping 只由 discovery endpoint 和[协议参考](/protocols/data-rest/)维护，架构页不复制第二份清单。

所有执行器统一经过输入/输出校验、实时 Scope、安全等级 ceiling、Purpose、声明 timeout、command 幂等和 hash-only audit。查询只接受结构化 filter；不接受任意 SQL、Cypher、OpenSearch DSL、shell 或数据库管理命令。

本机 `data-steward` Role seed 覆盖演示所需的最小 Scope。新增 Capability 时必须同时更新 Registry、Role/Scope、API、MCP、Skill、文档和验证。

## 数据模型与独立迁移历史

Data Foundation 不把 SQL 放进 Supabase migration。`infrastructure/data-foundation/postgres/migrations` 是唯一 canonical 历史：

| Migration                                    | 内容                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `0001_bootstrap.sql`                         | pgcrypto、PostGIS、btree_gist、unaccent、8 个业务 schema 与 migration ledger                     |
| `0002_authority_model.sql`                   | 目录、资产、入库、质量、血缘、知识、Operation、安全、Outbox 主模型                               |
| `0003_security_jobs_events.sql`              | RLS、授权 Session 参数、append-only guard、任务与事件安全                                        |
| `0004_job_lifecycle.sql`                     | claim/heartbeat/settle/fail/recover/cancel 与 Operation/Outbox 原子转换                          |
| `0005_content_blob_model.sql`                | 内容 blob 与资产身份分离、已存在数据回填、不可变存储引用                                         |
| `0006_content_lifecycle_constraints.sql`     | `QUARANTINED → FINGERPRINTED → RAW` 结构约束                                                     |
| `0007_version_publication_lifecycle.sql`     | 内容不可变前提下唯一允许一次 `UNPUBLISHED → PUBLISHED`                                           |
| `0008_governed_gis_tiles.sql`                | Martin 可发现的单一受控 MVT function；五个 scope 参数固定且不创建第二套身份                      |
| `0009_authority_state_transition_guards.sql` | Operation、Ingestion、Job 与 Transform Plan 的合法转换、权威 scope 不可变及精确 row-version 推进 |

TS7 runner 按四位版本排序，在 session advisory lock 下逐文件事务执行，并记录文件名和 SHA-256。已执行文件缺失、改名、内容漂移或非前缀历史会失败关闭。pgSTAC 使用官方 pyPgSTAC 0.9.12 migration，不伪造成 PostgreSQL extension。

业务模型共有 36 张表，全部 `ENABLE` 且 `FORCE ROW LEVEL SECURITY`；另有独立 `schema_migrations` ledger。API 和 Worker 通过部署脚本创建的不同非超级用户 role 访问，migration 不隐式授予 runtime。每个事务必须设置并验证 Tenant、Project、最高安全等级和 policy version；缺任一上下文返回零行或失败。

Martin 使用隔离的 `wiser_data_gis` 登录：`NOSUPERUSER`、`NOBYPASSRLS`，不继承通用 runtime role、没有业务表权限，只能执行 `service.wiser_spatial_extent_mvt`。该 security-definer function 严格接收 `tenantId/projectId/versionId/maxSecurityLevel/policyVersion` 五项 query 参数，在 SQL 内再次过滤 Version 与 spatial extent。

API 矢量瓦片先对 Version/spatial extent 做 RLS 授权，再给该 function 注入五项上下文。栅格瓦片只从可见 RAW asset 中选择 TIFF/GeoTIFF COG，验证 `tenants/.../versions/{versionId}/sha256/{hash}` 内容寻址 key 后，才在服务端生成 TiTiler 使用的内部 S3 URI；浏览器不能选择对象或 upstream。

Operation event、Audit event、Outbox、content/version 历史由 trigger 拒绝不合法的 UPDATE/DELETE。Operation、Ingestion Session、Job 与 Transform Plan 的数据库边界还强制合法生命周期边、identity/scope/policy 不可变、上传安全等级不可降低、冻结计划内容不可改，以及每次只允许 `row_version` 增加一；即使 runtime role 拥有表级 `UPDATE` 也不能绕过，Operation 终态内容也不能重写。仅保留非终态 Operation 进度聚合、运行中 Job 的 heartbeat/取消请求、所有确定性事实都相同的 Transform Plan 重放所需的窄同态更新。多 Job 聚合可让 Operation 在两个等待状态间转换；上传直接完成在 Core 与 PostgreSQL 中都限定到对应 Capability。复杂转换使用显式事务、行锁/乐观版本、唯一约束与 append-only 事实。

## 权威对象与提交

`DataItem` 是最小治理粒度，不等于文件、表或图层。processing stage、quality grade、acceptance status、publication status 与 L0–L3 security level 相互独立。

SeaweedFS adapter 强制 path-style S3，并只从已验证的 Tenant/Project/Upload/Version UUID 与小写 SHA-256 派生 key。客户端不能提交任意对象路径。上传支持无歧义的 `PRESIGNED_PUT` 与 `MULTIPART`；签名 URL 只存活 60–900 秒。完成前 HEAD 必须同时匹配 size、content type 与 SHA-256 metadata。

内容先停留在 `quarantine`。指纹后 `catalog.content_blob` 保存内容身份，正式提交把对象幂等提升到内容寻址的 raw/version key；相同 hash 可复用，不同 hash 永不覆盖。Abort 只能删除派生 quarantine 对象。API 读取版本资产时重新执行 Supabase 授权和 data-postgres RLS，追加 audit，再返回 60 秒 `303` signed redirect；STAC manifest 不直接暴露长期 S3 credential。

MCP Evidence/STAC Resource 通过真实 HTTP 权威边界读取。Evidence GET 只读取调用方 RLS 可见且关联已提交版本的 fragment，并追加 `data.evidence.read` hash-only audit。STAC GET 先把 collection 绑定到当前 Tenant/Project，再从固定内部 STAC origin 有界读取，剥离上游内部字段，并在 data-postgres 中复核已发布/已验收版本、Evidence、source hash、安全等级、policy 与质量；通过后追加 `data.stac-item.read`。两个 JSON 响应都不超过 256 KiB，STAC asset 只能指向上述短期授权下载入口。

正式版本只能从已批准且冻结的 review checkpoint 创建。一个 data-postgres 事务提交 DataItemVersion、质量/血缘事实、Operation event、Audit 与 Outbox；Supabase、data-postgres 和 S3 之间不伪造分布式事务。

## 确定性入库与 Agent 边界

研究数据包可在入库时选择可选的 `sourceRegistration` 类型。迁移 `0010_source_registration.sql` 将不可变的来源描述保存在受 RLS 保护的 Ingestion Session 中。有界 JSON 清单把来源、原始路径与哈希、脱敏副本、部分下载/样本/空文件状态及每个上传资产绑定到精确大小和 SHA-256；缺失、重复、多余或内容变化都会失败。零字节来源单独登记，不伪造非空上传。

准备后内容完全相同的不同路径可以引用同一个内容资产。每个路径仍保留各自的原始/准备后大小和哈希、处理方式、完整性与来源关联，且必须逐项匹配该资产；重复路径和重复的权威资产身份仍然无效。Skill 在每个来源登记内按准备后内容哈希只上传一次，并在清单和有界证据片段中保留全部路径别名。

该类型的验证范围是**来源登记**：保留原始对象，通过确定性清单校验创建包含来源名称、提供方和限制说明的 `METADATA_QUALITY` / `DECLARED` 版本，不运行文档/GIS 解析或 AI 映射计划。质量通过只表示登记完整性检查通过，不推断分析有效性、数据集完整性、许可或地理正确性。病毒扫描、指纹、安全继承、复核、事务/审计/Outbox 与发布门禁仍然生效。冻结的来源限制会进入证据、图谱和 STAC 检索投影。

入库使用 18 个状态：

```text
RECEIVED → QUARANTINED → SECURITY_SCANNED → FINGERPRINTED
→ PROFILED → CLASSIFIED → SCHEMA_MAPPED → SEMANTIC_MAPPED
→ VALIDATED → SPATIOTEMPORAL_ALIGNED
→ REVIEW_REQUIRED / APPROVED / REJECTED
→ COMMITTED → PROJECTING → PUBLISHED

允许的非终态可按政策进入 FAILED 或 CANCELLED；
REJECTED、PUBLISHED、FAILED、CANCELLED 为终态。
```

默认 Worker 以具体 `data.ingestion.process.v1` Handler 执行入库：

1. 从权威表恢复上传资产和当前版本；
2. 通过 S3 reader 核对 size/media type；
3. 使用 ClamAV INSTREAM 扫描；
4. 流式计算 SHA-256 并固化指纹；
5. 用 Tika 解析 Markdown/文档，用受控 GeoJSON parser 保留来源 CRS；
6. 生成确定性 profile/classification；
7. fixture fake Agent 提出 schema/semantic plan，注入 validator 校验置信度与形状；
8. 确定性 transformer、质量规则与 EPSG:4326/4490/3857 对齐执行；
9. 冻结 hash-only review checkpoint，低置信度/高风险进入人工审核；
10. 批准后提交权威版本与 Outbox，等待五个 completion target ledger 成功再发布。

Tika 4 只运行在 Data 私有网络中。Worker 保持显式的 `PUT /rmeta/text` JSON 契约；挂载的服务端配置将请求限制为 16 MiB、抽取输出限制为一百万字符、总解析时间限制为 30 秒，并把 fork 池限制为一个子进程。HTTP `429` 与 `503` 仍作为可重试依赖失败，格式错误的 `400` 与超限的 `413` 则为终态失败。这样既吸收 Tika 4 的进程隔离与背压语义，也不向外暴露其原始错误正文。

Agent 只提出解释与计划，不能修改原始数据、静默纠正字段、决定质量/验收、绕过审核或直接写权威/投影存储。fake Agent 和 `DeterministicFakeEmbedding` 只用于测试、CI 与本机 smoke；同文本、版本和维度产生相同有限向量。Worker 记录 Agent run/action、模型 identity、input/output hash 与 transform plan，不把 prompt、凭据或对象正文写入 audit。

质量门禁只读取确定性检查；blocking rule 失败时即使总分过阈值也不能通过。派生安全等级取全部来源最高值，只能显式提高不能降低。发布要求已提交版本、可发布验收、通过质量门禁、`PROJECTING` 状态和五个唯一 `SUCCEEDED` completion target。

## 持久任务、Outbox 与投影

Worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED`、lease owner/expiry、heartbeat、priority、attempt count、确定性指数退避、取消、等待输入/审核、超时回收和 dead letter。带时间参数的 claim function 在更新前保留被选中行的真实 previous status；缺少 Job Attempt/Event/Outbox 语义的旧 claim function 已从数据库删除。Native Node HTTP 暴露 `/health/live`、`/health/ready` 与 Prometheus `/metrics`，优雅关闭先停止领取并等待 in-flight Handler。

`ProjectionOutboxConsumer` 读取单调 checkpoint。每个 target 的 `PENDING/RUNNING/SUCCEEDED/FAILED` ledger 跨崩溃保留；外部写成功但 ledger 尚未更新时可安全重试，已成功 target 会跳过。投影 identity 由 DataItem/Version/Evidence 等权威 ID 派生：

若五个 completion target 已成功，但对应 Operation 已进入 `FAILED` 或 `CANCELLED`，该 publication poison event 不得改写 Operation 终态，也不得发布权威版本。Consumer 以 `PUBLICATION_OPERATION_TERMINAL` 写入 `consumer_checkpoint.last_error` 并推进该 event，避免队首永久阻塞；后续成功 event 清除摘要。原 Job、Operation、target ledger 与版本证据全部保留。

- data-postgres/PostGIS 的 `catalog.spatial_extent` 保存受 RLS 保护的 source geometry、CGCS2000 canonical geometry 与 Web Mercator display derivative；权威记录不可随投影缓存清空；
- Weaviate 使用 Worker 提供的固定版本向量与受认证 tenant；
- OpenSearch 使用受治理 ICU 索引；
- Neo4j 使用固定参数化 `MERGE`；
- pgSTAC 写 STAC 1.1 Collection/Item，asset href 指向受控 API 下载入口。

### 中文与中英混合检索合同

正文以中文为主、允许英文与中英混合，但三个检索投影不重复承担同一信号：

- **OpenSearch 是正文词法主召回。** `wiser-evidence-v2` 对同一 `content` 建立三个受控字段：ICU 主字段先做 `nfkc_cf` Unicode 兼容归一化，再执行 `icu_tokenizer` 与 `icu_folding`；官方 SmartCN 字段补充简体中文词典/HMM 边界；低权重 CJK 字段用重叠双字词兜底分词歧义。查询固定组合 ICU `3`、SmartCN `2`、CJK `0.75` 与 ICU phrase `4`，至少一路命中；权重只是在建立 judgment set 前的受治理基线，不能替代 Recall/NDCG 评测。通用 n-gram、非官方 IK 与未经审阅的同义词文件不进入默认生产路径。参见 [OpenSearch ICU analyzer](https://docs.opensearch.org/latest/analyzers/language-analyzers/icu/)、[CJK analyzer](https://docs.opensearch.org/latest/analyzers/language-analyzers/cjk/)与[官方插件清单](https://docs.opensearch.org/latest/install-and-configure/additional-plugins/)。
- **Weaviate 是纯向量语义召回。** `WiserEvidenceChunkV2` 继续使用 Worker 提供的版本化向量，但 `semantic` channel 改用 `nearVector`，不再在内部重复 BM25；因此 OpenSearch lexical 不会在外层 RRF 中重复投票。正文只存储、不建倒排索引；Tenant/Project/Version、安全、发布与 channel 等字段使用 `field` tokenization 并只为实际过滤建立索引。查询与写入向量必须精确匹配配置维度，租户由受控写入显式创建，`autoTenantCreation` 关闭。参见 [Weaviate bring-your-own vectors](https://docs.weaviate.io/weaviate/concepts/search/vector-search#bring-your-own-vector) 与 [multi-tenancy](https://docs.weaviate.io/weaviate/manage-collections/multi-tenancy)。
- **Neo4j 是图种子召回。** Worker 在写图前幂等创建并等待 `wiser_entity_name_cjk_v1` ONLINE；该全文索引对 `WiserEntity.name` 使用官方 `cjk` analyzer、同步更新，再按 Lucene score 排序并沿 `EVIDENCED_BY` 回到 Evidence。用户查询只允许 NFKC 后最多 64 个 literal term，所有 Lucene 特殊字符由服务端转义；Tenant、Project、安全、policy、验收与发布条件同时复核 entity、relation 与 evidence。内置 CJK 是双字词 analyzer，不处理简繁转换、拼音、领域词典，也不能可靠召回长文本中的单汉字，因此 Neo4j 不替代 OpenSearch 正文检索。参见 [Neo4j full-text indexes](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/)。

每个 backend 先形成独立排名；`SearchOrchestrator` 再执行固定 `RRF k=60`，不直接相加 OpenSearch BM25、Weaviate distance 与 Neo4j Lucene score。OpenSearch analyzer、Weaviate schema 或 Neo4j analyzer 变化都使用新版本物理索引/collection，从 data-postgres 权威事实重放投影并完成中文、英文、中英混合 golden queries 后切读；不能让 `IF NOT EXISTS` 或一次 schema `200` 掩盖旧索引语义。测试/CI/本机 smoke 仍使用确定性 fake embedding；生产语义召回必须另行选择并锁定一个经过中文/英文评测的 embedding model、版本和维度。

对应 query adapter 下推 Tenant、Project、Version、security、policy version、acceptance、publication、domain 与 channel filter。`SearchOrchestrator` 并行召回，固定 `RRF k=60`，按 DataItem+Version 去重，再逐条授权并脱敏 excerpt。

## 协议与产品面

- REST：`/api/data/v1` 的 discovery、22 项 Capability、Operation SSE、Evidence/STAC Resource、授权资产重定向，以及唯一外部 OGC/STAC/矢量/栅格 GIS 代理；22 个 Capability 的 Fastify OpenAPI 直接由 Zod 4 Registry 投影，GIS GET 使用显式安全 route Schema，共享文档标题为 **WISER Platform API**；见 [Data REST](/protocols/data-rest/)。
- GraphQL：`POST /graphql`，22 个 schema-first field 共用同一 Handler；见 [Data GraphQL](/protocols/data-graphql/)。
- MCP：stdio/无状态 Streamable HTTP，22 个 Tool 与受控 Resource 都只调用 HTTP；见 [Data MCP](/protocols/data-mcp/)。
- Skill：`skills/wiser-data-foundation` 定义发现、查询、上传、入库、Operation 与安全解释流程。
- Web：现有 Next.js 应用中的 14 个 Data route，server-only DAL、真实 Supabase Session、双语/主题、不可变版本选择，以及 MapLibre 的 PostGIS authority GeoJSON、STAC extent、受控 vector MVT 与 raster 四图层。

DataItem detail 的 `?version=<uuid>` 会把指定版本送入 API 并核对 `selectedVersion`，版本列表以 `aria-current` 切换并可打开受控地图。地图查询为 `?bbox=minx,miny,maxx,maxy&dataItem=<uuid>&version=<uuid>&crs=EPSG:4326|EPSG:4490`，可分别切换四图层，显示固定 Version 与 `source CRS → EPSG:3857`。对 `data.geo.query`，省略单数 `versionId` 时，从每个 DataItem 的最新可见且已提交版本选择 extent；指定时则从该精确不可变版本选择 extent；每次响应受 `first` 限制，并用绑定 snapshot/query/scope 的不透明 `nextCursor` 继续。若同时给出 `dataItemIds`，它与上述版本选择取交集；版本不可见或不存在时返回空结果集。`data.geo.intersect` 使用同样的 snapshot cursor，先选择 DataItem target 的版本，再合并该版本全部 sibling extent；任一 target 不存在、不可见或无 extent 时返回空结果，绝不回退历史版本。Map server 必须在权威 PostGIS 版本排名之前把选定的 `versionId` 传入查询，受控取完不超过 10,000 个 feature 的分页，并在 cursor 重复或越界时 fail closed，不能先取最新版本再做事后过滤。浏览器只请求同源 `/api/data-foundation/geo/...`；Next server 使用刚验证的 Supabase 短期 Session 追加 Tenant/Project/Purpose 后转发 Fastify，Bearer 和内部 GIS origin 永不进入客户端。

每个当前 `DataItemVersion` 都必须带有权威 `tileAvailability: { vector, raster }`。`vector=true` 表示这个可见、已提交 Version 存在可见的版本级 spatial extent；`raster=true` 表示存在可见 RAW TIFF/GeoTIFF asset，且 blob/hash/input 关联和内容寻址 storage key 全部有效。这两个布尔量只表示受控 tile source 可路由，不代表 Martin/TiTiler 健康，也不证明 COG 合规。Catalog 链接同时携带 DataItem 与 Version，Map 在生成任一 tile URL 前会重新读取该精确权威配对。

Web 负责治理与查询，不在 Server Action 或 Route Handler 执行文件解析、向量化、GIS 转换或投影。其同源 GIS Route Handler 只是有界认证代理；mutation 由 REST、GraphQL、MCP 或 Skill 发起。

## 依赖与可执行验证

npm 的精确版本由对应 `package.json` 与根 `pnpm-lock.yaml` 定义；Data 容器的稳定 tag、digest 与兼容注记由 `compose.yaml` 和 `infrastructure/data-foundation/versions.env` 定义。架构文档不复制这些会频繁变化的清单。

`pnpm data:smoke` 从上传、扫描、解析、受控 Agent 计划、确定性转换、质量/人工门禁、权威提交与 Outbox 一直验证到全部投影，并通过 REST、GraphQL、MCP 和登录后的 Web 回读；重复消费同一 Outbox event 不得创建重复权威或投影对象。完整命令矩阵见[测试与验证](/development/testing/)，数据库重置与迁移纪律见[数据库与迁移](/development/databases/)。
