---
title: 数据基座领域架构
description: Data Foundation 已交付的权威边界、入库纵切、投影、协议与验证合同。
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
lastReviewedAt: 2026-08-22
lastReviewedCommit: fe6687b78bae4241b59c82280f4a97b2fcff05d3
---

## 已交付边界

Data Foundation 是与 Agent EXCON 平级的 WISER 业务系统。它拥有 DataItem、不可变版本、资产、入库、质量、血缘、知识、检索、GIS、Operation 与投影事实；它不拥有用户 Session、Tenant、Project、Membership、Role 或 Token。Supabase Auth/PostgreSQL 是统一身份与控制面，独立 data-postgres/PostGIS 与 S3 兼容对象存储构成 Data 权威面。

当前默认 Data runtime 已组合：

```text
Supabase principal + Tenant/Project/Purpose
  → Fastify REST / schema-first GraphQL
  → 同一 DataCapabilityHandler（22 项静态 executor）
  → data-postgres RLS transaction / SeaweedFS S3
  → PostgreSQL durable job + Transactional Outbox
  → Data Worker
  → PostGIS / Weaviate / OpenSearch / Neo4j / STAC
  → REST / GraphQL / MCP / authenticated Web readback
```

GeoServer、TiTiler 和 Martin 作为本机 GIS 服务存在于同一个精确锁定 profile；当前权威 Outbox 的五个完成目标是 PostGIS、Weaviate、OpenSearch、Neo4j 与 STAC。任何投影都可清空重建，不承担身份、授权、验收或发布权威。

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

Registry 的稳定顺序包含 22 项：

```text
data.catalog.search              data.catalog.get
data.query                       data.search.federated
data.knowledge.search            data.graph.expand
data.graph.findPath              data.geo.query
data.geo.intersect               data.ingestion.create
data.ingestion.submit            data.operation.get
data.catalog.create              data.catalog.versions.list
data.catalog.versions.get        data.uploadSession.create
data.uploadSession.complete      data.ingestion.get
data.ingestion.approve           data.ingestion.reject
data.operation.cancel            data.operation.events
```

所有执行器统一经过输入/输出校验、实时 Scope、安全等级 ceiling、Purpose、声明 timeout、command 幂等和 hash-only audit。查询只接受结构化 filter；不接受任意 SQL、Cypher、OpenSearch DSL、shell 或数据库管理命令。

首批能力使用 `data.catalog.read`、`data.query.execute`、`data.search.execute`、`data.knowledge.read`、`data.graph.read`、`data.geo.read`、`data.ingestion.write`、`data.operation.read` 与 `data.publish`。本机 `data-steward` Role seed 覆盖这九项；新增 Capability 时必须同时更新 Registry、Role/Scope、API、MCP、Skill、文档和验证。

## 数据模型与独立迁移历史

Data Foundation 不把 SQL 放进 Supabase migration。`infrastructure/data-foundation/postgres/migrations` 是唯一 canonical 历史：

| Migration                                | 内容                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `0001_bootstrap.sql`                     | pgcrypto、PostGIS、btree_gist、unaccent、8 个业务 schema 与 migration ledger |
| `0002_authority_model.sql`               | 目录、资产、入库、质量、血缘、知识、Operation、安全、Outbox 主模型           |
| `0003_security_jobs_events.sql`          | RLS、授权 Session 参数、append-only guard、任务与事件安全                    |
| `0004_job_lifecycle.sql`                 | claim/heartbeat/settle/fail/recover/cancel 与 Operation/Outbox 原子转换      |
| `0005_content_blob_model.sql`            | 内容 blob 与资产身份分离、已存在数据回填、不可变存储引用                     |
| `0006_content_lifecycle_constraints.sql` | `QUARANTINED → FINGERPRINTED → RAW` 结构约束                                 |
| `0007_version_publication_lifecycle.sql` | 内容不可变前提下唯一允许一次 `UNPUBLISHED → PUBLISHED`                       |

TS7 runner 按四位版本排序，在 session advisory lock 下逐文件事务执行，并记录文件名和 SHA-256。已执行文件缺失、改名、内容漂移或非前缀历史会失败关闭。pgSTAC 使用官方 pyPgSTAC 0.9.12 migration，不伪造成 PostgreSQL extension。

业务模型共有 36 张表，全部 `ENABLE` 且 `FORCE ROW LEVEL SECURITY`；另有独立 `schema_migrations` ledger。API 和 Worker 通过部署脚本创建的不同非超级用户 role 访问，migration 不隐式授予 runtime。每个事务必须设置并验证 Tenant、Project、最高安全等级和 policy version；缺任一上下文返回零行或失败。

Operation event、Audit event、Outbox、content/version 历史由 trigger 拒绝不合法的 UPDATE/DELETE。复杂转换使用显式事务、行锁/乐观版本、唯一约束与 append-only 事实。

## 权威对象与提交

`DataItem` 是最小治理粒度，不等于文件、表或图层。processing stage、quality grade、acceptance status、publication status 与 L0–L3 security level 相互独立。

SeaweedFS adapter 强制 path-style S3，并只从已验证的 Tenant/Project/Upload/Version UUID 与小写 SHA-256 派生 key。客户端不能提交任意对象路径。上传支持无歧义的 `PRESIGNED_PUT` 与 `MULTIPART`；签名 URL 只存活 60–900 秒。完成前 HEAD 必须同时匹配 size、content type 与 SHA-256 metadata。

内容先停留在 `quarantine`。指纹后 `catalog.content_blob` 保存内容身份，正式提交把对象幂等提升到内容寻址的 raw/version key；相同 hash 可复用，不同 hash 永不覆盖。Abort 只能删除派生 quarantine 对象。API 读取版本资产时重新执行 Supabase 授权和 data-postgres RLS，追加 audit，再返回 60 秒 `303` signed redirect；STAC manifest 不直接暴露长期 S3 credential。

正式版本只能从已批准且冻结的 review checkpoint 创建。一个 data-postgres 事务提交 DataItemVersion、质量/血缘事实、Operation event、Audit 与 Outbox；Supabase、data-postgres 和 S3 之间不伪造分布式事务。

## 确定性入库与 Agent 边界

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

默认 Worker 现在注册了具体 `data.ingestion.process.v1` Handler，而不是空 Registry：

1. 从权威表恢复上传资产和当前版本；
2. 通过 S3 reader 核对 size/media type；
3. 使用 ClamAV INSTREAM 扫描；
4. 流式计算 SHA-256 并固化指纹；
5. 用 Tika 解析 Markdown/文档，用受控 GeoJSON parser 保留来源 CRS；
6. 生成确定性 profile/classification；
7. fixture fake Agent 提出 schema/semantic plan，注入 validator 校验置信度与形状；
8. 确定性 transformer、质量规则与 EPSG:4326/4490/3857 对齐执行；
9. 冻结 hash-only review checkpoint，低置信度/高风险进入人工审核；
10. 批准后提交权威版本与 Outbox，等待五类投影成功再发布。

Agent 只提出解释与计划，不能修改原始数据、静默纠正字段、决定质量/验收、绕过审核或直接写权威/投影存储。fake Agent 和 `DeterministicFakeEmbedding` 只用于测试、CI 与本机 smoke；同文本、版本和维度产生相同有限向量。Worker 记录 Agent run/action、模型 identity、input/output hash 与 transform plan，不把 prompt、凭据或对象正文写入 audit。

质量门禁只读取确定性检查；blocking rule 失败时即使总分过阈值也不能通过。派生安全等级取全部来源最高值，只能显式提高不能降低。发布要求已提交版本、可发布验收、通过质量门禁、`PROJECTING` 状态和五个唯一 `SUCCEEDED` 投影。

## 持久任务、Outbox 与投影

Worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED`、lease owner/expiry、heartbeat、priority、attempt count、确定性指数退避、取消、等待输入/审核、超时回收和 dead letter。Native Node HTTP 暴露 `/health/live`、`/health/ready` 与 Prometheus `/metrics`，优雅关闭先停止领取并等待 in-flight Handler。

`ProjectionOutboxConsumer` 读取单调 checkpoint。每个 target 的 `PENDING/RUNNING/SUCCEEDED/FAILED` ledger 跨崩溃保留；外部写成功但 ledger 尚未更新时可安全重试，已成功 target 会跳过。投影 identity 由 DataItem/Version/Evidence 等权威 ID 派生：

- PostGIS 保留 source geometry，并存 CGCS2000 与 Web Mercator 派生形状；
- Weaviate 使用 Worker 提供的固定版本向量与受认证 tenant；
- OpenSearch 使用受治理 ICU 索引；
- Neo4j 使用固定参数化 `MERGE`；
- pgSTAC 写 STAC 1.1 Collection/Item，asset href 指向受控 API 下载入口。

对应 query adapter 下推 Tenant、Project、Version、security、policy version、acceptance、publication、domain 与 channel filter。`SearchOrchestrator` 并行召回，固定 `RRF k=60`，按 DataItem+Version 去重，再逐条授权并脱敏 excerpt。

## 协议与产品面

- REST：`/api/data/v1` 的 discovery、22 项 Capability、Operation SSE 与授权资产重定向；见 [Data REST](/protocols/data-rest/)。
- GraphQL：`POST /graphql`，22 个 schema-first field 共用同一 Handler；见 [Data GraphQL](/protocols/data-graphql/)。
- MCP：stdio/无状态 Streamable HTTP，22 个 Tool 与受控 Resource 都只调用 HTTP；见 [Data MCP](/protocols/data-mcp/)。
- Skill：`skills/wiser-data-foundation` 定义发现、查询、上传、入库、Operation 与安全解释流程。
- Web：现有 Next.js 应用中的 14 个 Data route，server-only DAL、真实 Supabase Session、双语、主题、状态/错误分支和 MapLibre GeoJSON 地图。

Web 当前负责治理与查询，不在 Server Action 或 Route Handler 执行文件解析、向量化、GIS 转换或投影。mutation 由 REST、GraphQL、MCP 或 Skill 发起。

## 精确锁定的本机 profile

Compose 使用 PostgreSQL/PostGIS `18-3.6`、pyPgSTAC `0.9.12`、SeaweedFS `4.43`、Weaviate `1.39.0`、OpenSearch/Dashboards `3.8.0`、Neo4j `2026.07.1`、GeoServer `3.0.1`、STAC API `6.3.1`、TiTiler `2.2.1`、Martin `1.14.0`、Tika `3.3.1.0` 与 ClamAV `1.5.4`。每个镜像在 Compose 和 `versions.env` 同时固定 tag+digest。

OpenSearch initializer 验证官方 ICU artifact SHA-512 并可重复执行。所有宿主端口绑定 `127.0.0.1`；服务默认 drop Linux capabilities、启用 `no-new-privileges`、资源上限与日志轮转，只给确实需要初始化卷/降权的入口加回最小 capability。PostGIS 与 GeoServer 当前官方镜像仅提供 amd64，Apple Silicon 由 Compose 显式模拟。

## 可执行完成证明

`pnpm data:smoke` 的 18 个固定 step ID 真实贯穿：上传 Session、两个 fixture、ClamAV、SHA-256、解析、fake Agent、确定性转换、质量/人工审核、权威提交、raw 内容、Outbox、五类投影、projection ledger、REST、GraphQL、MCP 和登录后的 Web。随后回退 consumer checkpoint 重放同一 Outbox event，验证版本、对象、节点和投影不重复。

该 smoke 与 `pnpm verify`、`pnpm supabase:verify`、`pnpm data:verify`、Docpact、Compose config 一起构成当前交付门禁。
