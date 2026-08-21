---
title: 数据基座领域架构
description: Data Foundation 的权威边界、公开契约、确定性领域规则与完整纵切约束。
docType: architecture
scope: data-foundation
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 Data Foundation DTO、Capability、状态机或领域门禁时
  - 实现 data-postgres、对象存储、投影、API、MCP、Worker 或 Web 时
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
lastReviewedCommit: bf610e20dfca64f3a28f201241788430cebe2a82
---

## 边界与当前实现

Data Foundation 是 WISER 内与 Agent EXCON 平级的业务系统。它拥有 DataItem、不可变版本、资产、入库会话、质量、血缘、知识、检索与 GIS 事实；不拥有用户 Session、Tenant、Project、Role 或 Token。Supabase 是统一身份与控制面；独立 data-postgres/PostGIS 与 S3 兼容对象存储构成数据权威面；搜索、图谱、STAC 与 GIS 服务均为可重建投影。

当前已落地 `@wiser/data-contracts`、`@wiser/data-core`、data-postgres/S3 authority `@wiser/data-infra`、`@wiser/data-worker` 的持久任务 runtime，以及完整依赖 Compose profile。可重建 PostGIS、Weaviate、OpenSearch、Neo4j、STAC adapter，重放安全的 Outbox ledger、固定 backend query 与受治理的 RRF SearchOrchestrator 也已可执行。具体入库 Handler、默认 Worker 接线与完整 transport 仍须沿同一边界完成，当前阶段不等于最终交付。

## 唯一公开契约源

`@wiser/data-contracts` 是 REST、GraphQL、MCP、Skill 与运行时校验的 transport-neutral 契约源。公开对象使用 `z.strictObject`，同时拒绝未知字段和缺失必填字段。生成的 draft-7 JSON Schema 经过规范化 SHA-256 回归；12 项首批 Capability 的 REST、GraphQL、MCP 与 Skill 映射也由精确表格测试锁定，禁止 AST 扫描或 transport 自行发明 Schema。

Registry 保留首批 12 个 Capability 的稳定顺序：

```text
data.catalog.search       data.catalog.get
data.query                data.search.federated
data.knowledge.search     data.graph.expand
data.graph.findPath       data.geo.query
data.geo.intersect        data.ingestion.create
data.ingestion.submit     data.operation.get
```

其后追加 10 个控制面 Capability，完整覆盖当前要求的 REST/GraphQL/MCP 操作：

```text
data.catalog.create              data.catalog.versions.list
data.catalog.versions.get        data.uploadSession.create
data.uploadSession.complete      data.ingestion.get
data.ingestion.approve           data.ingestion.reject
data.operation.cancel            data.operation.events
```

`data.operation.events` 的 REST mapping 明确使用 SSE。图查询仍由结构化 `graph.expand/findPath` 输入表达，不开放任意 Cypher；查询能力均禁止任意 SQL 或 OpenSearch DSL。

上传契约使用可判别且无歧义的模式。`PRESIGNED_PUT` 只暴露单一 URL，并禁止 multipart 字段；`MULTIPART` 暴露不透明 upload id、连续 part number、精确 part size、逐 part URL/过期时间，且不提供单对象 URL。完成请求携带同一不透明 id 与连续 ETag；未知字段、混合模式或乱序 payload 在对象存储 I/O 前即失败。

共享 Fastify 宿主现已提供可注入的 `data.foundation` 模块。`/api/data/v1/capabilities` 直接通过 Zod 4 draft-7 generator 序列化有序 Registry，客户端无需 AST 扫描即可读取四类 transport mapping。`/api/data/v1/health` 从注入 probe 报告 data-postgres、对象存储与 Worker readiness；任一权威依赖缺失即返回 503。默认进程尚未注册具体 probe，因此不能宣称 Data Foundation runtime ready。

Transport-neutral `DataCapabilityHandler` 已完成：每个 Registry 条目对应一个静态 executor，统一执行 Zod 输入/输出门禁、实时 Scope 与安全上限、command 幂等、有界执行 signal 和仅含 hash 的 audit 事实。具体 executor 与路由仍是下一接线边界；Handler 存在不等于 REST/GraphQL 已完整交付。

该 Handler 的 REST 投影也已覆盖全部 Registry mapping，包括无碰撞输入组合、UUID 幂等、强版本前置条件、ETag、no-store 与有界 Operation SSE。7 个读取 executor 已通过短 data-postgres RLS 事务提供目录/数据条/版本、入库、Operation 与事件分页，并使用 scope-bound cursor 和仅 hash 的 append-only audit。Command 与专用查询 executor 仍阻塞默认 runtime 注册。

`DataItem` 是最小治理粒度，不等于文件、表或图层。质量等级、验收状态、发布状态和安全等级是四个独立维度；任何适配器都不能把它们压缩成一个“状态”。

首批 Capability 使用 9 个唯一 Scope：`data.catalog.read`、`data.query.execute`、`data.search.execute`、`data.knowledge.read`、`data.graph.read`、`data.geo.read`、`data.ingestion.write`、`data.operation.read` 与 `data.publish`。Supabase 的 `data-steward` 本地角色必须完整覆盖它们；新增 Capability 时 Registry 与 Role seed/管理命令必须在同一 Green 里对齐。

## 确定性领域政策

入库状态严格使用 18 个值：

```text
RECEIVED → QUARANTINED → SECURITY_SCANNED → FINGERPRINTED
→ PROFILED → CLASSIFIED → SCHEMA_MAPPED → SEMANTIC_MAPPED
→ VALIDATED → SPATIOTEMPORAL_ALIGNED
→ REVIEW_REQUIRED / APPROVED / REJECTED
→ COMMITTED → PROJECTING → PUBLISHED

任一允许中的非终态可按政策进入 FAILED 或 CANCELLED；
REJECTED、PUBLISHED、FAILED、CANCELLED 为终态。
```

转换执行本身是 `SEMANTIC_MAPPED → VALIDATED` 之间的确定性步骤，不额外创造 `TRANSFORMED` 状态。非法转换抛出带稳定错误码的领域错误。Operation 使用独立的 `PENDING/RUNNING/WAITING_INPUT/WAITING_REVIEW/SUCCEEDED/FAILED/CANCELLED` 状态机。

质量门禁只读取确定性检查，按正权重计算稳定分数；blocking rule 失败时即使分数达到阈值也不能通过。A/B/C 表示质量等级，不等于验收结论。只有 `PASSED` 或 `CONDITIONALLY_PASSED` 才具有发布资格。

派生数据的安全等级取全部来源的最高等级。调用方可以显式提高，但不能降低继承等级。发布还必须同时满足：权威版本已提交、质量门禁通过、验收可发布、入库处于 `PROJECTING`，且每个唯一投影均为 `SUCCEEDED`。

测试、CI 与本机 smoke 使用 `DeterministicFakeEmbedding`：以精确文本和声明的 fake model version 做 domain-separated SHA-256 扩展，再归一化到配置的 8–4096 维。它不依赖网络、时钟、随机数或模型；相同文本/版本必得相同有限数值，且显式 model identity 会进入投影 metadata。

## 权威提交与投影

正式版本只能由 `APPROVED → COMMITTED` 流程创建。data-postgres 事务原子写入版本、Operation event、审计和 Transactional Outbox；对象内容以 SHA-256 寻址，正式 manifest 只引用已验证的不可变对象。Supabase、data-postgres 和对象存储之间不伪造分布式事务。

S3 authority adapter 强制 SeaweedFS path-style endpoint，并从经过验证的 Tenant/Project/Upload/Version UUID 与小写 SHA-256 派生 `quarantine`、`raw`、`versions` key，拒绝调用方提供任意路径。单 PUT、multipart 和下载 URL 的 TTL 限制为 60–900 秒。提交前用 HEAD 同时核对 size 与 `sha256` metadata；目标已存在且一致时复用，hash 不同则返回 immutable conflict，绝不覆盖。Abort 只能删除派生的 quarantine key，不能删除 raw 或 version 对象；底层 endpoint 错误不会把凭据或原始错误正文暴露给调用方。

前 3 个纯 SQL migration 初始化 pgcrypto、PostGIS、btree_gist、unaccent、8 个业务 Schema、`schema_migrations` 与 35 张权威表；第 4 个 migration 固化 Job claim、heartbeat、settle、fail、recover、cancel 与 Operation event/Outbox 原子写入。pgSTAC 按官方 pyPgSTAC migration 管理，不伪造成 `CREATE EXTENSION pgstac`。TS7 runner 按四位版本排序，记录文件名和 SHA-256，在 session advisory lock 下逐文件事务执行；已执行文件缺失、改名、内容漂移或非前缀历史都会 fail closed。

全部 35 张权威表启用并 FORCE RLS。runtime 读取必须同时设置经过验证的 Tenant、Project、最高安全等级和 policy version Session 参数；缺任一参数时返回零行。Migration 不创建也不授权 runtime role，部署层必须显式创建最小权限角色。Operation event、Audit event 与 Outbox event 使用数据库 trigger 拒绝 UPDATE/DELETE；持久任务通过 `FOR UPDATE SKIP LOCKED`、lease owner/expiry、attempt count 与优先级领取。

Data Worker 使用静态 Handler Registry；重复 job type 在启动时拒绝。Scheduler 注入时钟，执行超时回收、批量 claim、heartbeat、确定性指数退避、dead letter、取消及 `WAITING_INPUT/WAITING_REVIEW`；优雅停机会等待 in-flight Handler 后再关闭连接。Node 原生 HTTP 暴露 `/health/live`、`/health/ready` 与 Prometheus `/metrics`，不引入第二个 Web framework。通用 runtime 已交付，但默认入口尚未注册具体业务 Handler，因此不能被描述为完整入库 Worker。

Worker 在启动时读取 canonical `DATA_*` 环境变量；数据库 URL、UUID scope、安全等级、lease/heartbeat 关系、host 或端口无效时 fail closed。旧 `WISER_DATA_*` 只作为临时且可观测的兼容 alias；canonical 值始终优先，canonical 已提供但无效时绝不回退 alias。

## 精确锁定的本机依赖 profile

`data-foundation` Compose profile 运行独立 PostgreSQL 18.6/PostGIS 3.6 权威库与 pyPgSTAC 0.9.12，以及 SeaweedFS 4.43、Weaviate 1.39.0、OpenSearch/Dashboards 3.8.0、Neo4j 2026.07.1、GeoServer 3.0.1、STAC API 6.3.1、TiTiler 2.2.1、Martin 1.14.0、Tika 3.3.1.0 和 ClamAV 1.5.4。Compose 中每个镜像都直接写稳定 tag 与 sha256 digest，并在 `infrastructure/data-foundation/versions.env` 再次审计登记。

OpenSearch 官方镜像不含 `analysis-icu`。一次性 initializer 只下载官方 3.8.0 artifact，先验证 SHA-512，再写入只读 named plugin volume；OpenSearch readiness 同时验证 cluster health 与插件已加载。所有服务先 drop 全部 Linux capability；只有经真实启动证明需要初始化 named volume 或降低 UID/GID 的上游入口，才加回 CHOWN/DAC/FOWNER/SETUID/SETGID 子集。所有端口绑定回环地址，使用非默认本机 credential，日志轮转、资源受限，且无 host network。

PostgreSQL 18/PostGIS 与 GeoServer 当前官方镜像仅有 amd64，因此 Compose 显式声明 `linux/amd64`，在 Apple Silicon 确定性模拟。完整 WISER migration 已在该 PostgreSQL 18.6 容器上执行，SeaweedFS 的匿名 S3 访问也已确认拒绝；这些兼容性证据不能替代最终全栈 smoke 门禁。

`ProjectionOutboxConsumer` 从单调 checkpoint 后读取版本提交事件。每个 target 的 `PENDING/RUNNING/SUCCEEDED/FAILED` ledger 跨崩溃保留；重放会跳过已成功 target，并安全重复“外部写已完成、ledger 尚未更新”的写入。各 adapter 使用确定性 identity 和固定参数化请求：PostGIS 保存 source/CGCS2000/Web-Mercator geometry，Weaviate 使用 Worker vector 与认证 tenant，OpenSearch 保存 ICU 治理文档，Neo4j 使用固定 MERGE 事实，pgSTAC 使用 STAC 1.1 Collection/Item。对应搜索 backend 下推 Tenant、Project、Version、安全等级、policy version、验收、发布、业务域和 channel 过滤，调用方不能传 SQL、Cypher 或 DSL。RRF 固定 `k=60`，按 DataItem+Version 去重，对每个 hit 再授权并脱敏 excerpt。精确锁定的真实容器已经分别从 OpenSearch、Weaviate、Neo4j 与 pgSTAC 写读对返回 1 条授权且可重放结果。默认 Worker 尚未注册这些 Handler；任何读取、下载、导出或发布仍须由 API 使用 Supabase 权威上下文复核。

## 完成门槛

只有两个 fixture 能真实贯穿上传、隔离、扫描、指纹、解析、fake AI 映射、确定性转换、质量检查、权威提交、Outbox、全部投影，并可从 REST、GraphQL、MCP 与统一 Web UI 查询时，Data Foundation 初始化才算完成。Fake embedding 必须稳定，重复消费同一 Outbox event 不得生成重复版本、对象、节点或投影。
