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
lastReviewedCommit: 9465d7fada3ed33d926f6afac5041f8f9980c817
---

## 边界与当前实现

Data Foundation 是 WISER 内与 Agent EXCON 平级的业务系统。它拥有 DataItem、不可变版本、资产、入库会话、质量、血缘、知识、检索与 GIS 事实；不拥有用户 Session、Tenant、Project、Role 或 Token。Supabase 是统一身份与控制面；独立 data-postgres/PostGIS 与 S3 兼容对象存储构成数据权威面；搜索、图谱、STAC 与 GIS 服务均为可重建投影。

当前已落地 `@wiser/data-contracts` 与 `@wiser/data-core`：前者提供严格 Zod 4 DTO 和静态 Capability Registry；后者只包含纯净、同步、确定性的领域政策。数据库、对象存储、任务、Outbox、投影及 transport 仍须沿同一边界完成，当前阶段不等于最终交付。

## 唯一公开契约源

`@wiser/data-contracts` 是 REST、GraphQL、MCP、Skill 与运行时校验的 transport-neutral 契约源。公开对象使用 `z.strictObject`，同时拒绝未知字段和缺失必填字段。生成的 draft-7 JSON Schema 经过规范化 SHA-256 回归；12 项首批 Capability 的 REST、GraphQL、MCP 与 Skill 映射也由精确表格测试锁定，禁止 AST 扫描或 transport 自行发明 Schema。

首批 Capability：

```text
data.catalog.search       data.catalog.get
data.query                data.search.federated
data.knowledge.search     data.graph.expand
data.graph.findPath       data.geo.query
data.geo.intersect        data.ingestion.create
data.ingestion.submit     data.operation.get
```

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

## 权威提交与投影

正式版本只能由 `APPROVED → COMMITTED` 流程创建。data-postgres 事务原子写入版本、Operation event、审计和 Transactional Outbox；对象内容以 SHA-256 寻址，正式 manifest 只引用已验证的不可变对象。Supabase、data-postgres 和对象存储之间不伪造分布式事务。

Worker 消费 Outbox 后幂等构建 PostGIS、Weaviate、OpenSearch、Neo4j、STAC 与 GIS 投影。投影保存 Tenant、Project、Version、安全等级和策略版本过滤，但任何读取、下载、导出或发布仍由 API 使用 Supabase 权威上下文复核。

## 完成门槛

只有两个 fixture 能真实贯穿上传、隔离、扫描、指纹、解析、fake AI 映射、确定性转换、质量检查、权威提交、Outbox、全部投影，并可从 REST、GraphQL、MCP 与统一 Web UI 查询时，Data Foundation 初始化才算完成。Fake embedding 必须稳定，重复消费同一 Outbox event 不得生成重复版本、对象、节点或投影。
