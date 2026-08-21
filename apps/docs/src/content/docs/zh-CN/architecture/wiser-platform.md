---
title: WISER 多系统平台
description: WISER、Agent EXCON、Data Foundation 与共享宿主的长期边界和一次性重构合同。
docType: architecture
scope: wiser-platform
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 新增系统、共享能力或部署单元时
  - 修改跨系统依赖、事实源或组合宿主时
whenToUpdate:
  - 系统清单、依赖方向、数据权威或完成门槛变化时
checkPaths:
  - apps/**
  - packages/**
  - infrastructure/**
  - supabase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 44a40c2e1d2ed4d6c0e071fa391f16d277e7e08d
---

## 决策摘要

WISER 是产品与平台总上下文。Agent EXCON 与 Data Foundation 是平级的业务系统，不是彼此内部的功能目录。它们复用同一套 Fastify、Next.js、MCP、Fumadocs、Supabase Auth 和可观测性入口，同时保留各自的领域模型、应用用例、Worker 与权威事实。

本次重构是一个连续交付目标。内部可以按 Red → Green → Refactor 分阶段并频繁提交，但中间阶段不能被描述为完整交付；只有 Agent EXCON 回归、Data Foundation 全纵切、统一 UI、双语文档、深浅主题、Compose、CI 和安全门禁全部通过后才完成。

## 系统边界

| 上下文          | 拥有的事实                                                                      | 不拥有                           |
| --------------- | ------------------------------------------------------------------------------- | -------------------------------- |
| WISER Platform  | 身份请求上下文、租户、项目、共享宿主、技术约定                                  | EXCON 裁决、数据版本和搜索投影   |
| Agent EXCON     | Scenario、Run、Task、Receipt、Artifact、Submission、Evaluation、Feedback        | 数据目录、通用对象存储、数据投影 |
| Data Foundation | DataItem、Version、Asset、Quality、Lineage、Publication、Knowledge、Search、GIS | 用户 Session、EXCON Run 与裁决   |

EXCON 场景发布时只能引用不可变的数据版本：`dataItemVersionId`、`contentHash` 与授权快照。运行中的演练不得隐式读取 Data Foundation 的“最新版本”，否则无法重放或复核。

## 共享宿主与调用方向

```text
Web / MCP / Skill
       │ HTTP
       ▼
WISER Fastify composition root
       ├── Agent EXCON adapter → application → Supabase/PostgreSQL
       └── Data adapter        → application → data-postgres / S3
                                               └── Outbox → Worker → projections
```

- API、MCP 和 Web 使用编译期静态注册，不扫描 TypeScript AST，也不在运行时发现插件。
- REST 与 GraphQL 在 API 进程内调用同一个 Capability Handler。
- MCP、Skill 和浏览器只访问 HTTP API，不导入业务 Handler，不连接数据库。
- 一个系统最多依赖另一个系统的公开 contracts 或 HTTP client，禁止导入对方的 core/infra。
- 每个权威数据库拥有自己的事务、Outbox 与审计；禁止跨 Supabase、data-postgres 和对象存储伪造分布式原子事务。

## 权威矩阵

| 存储                                     | 权威内容                                          | 一致性规则                                  |
| ---------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| Supabase Auth/PostgreSQL                 | 用户、Session、租户、项目、Membership、EXCON 事实 | 单一 WISER 身份与控制面                     |
| data-postgres/PostGIS                    | DataItem、版本、质量、血缘、Operation、Outbox     | Data Foundation 结构化权威面                |
| S3 兼容对象存储                          | 原始对象和不可变版本资产                          | 内容寻址、校验后由 PostgreSQL manifest 提交 |
| OpenSearch/Weaviate/Neo4j/STAC/GeoServer | 检索、图谱与 GIS 投影                             | 可清空、可重建、幂等、非授权权威            |
| OpenTelemetry                            | 技术诊断投影                                      | 可采样，不参与业务状态、权限或裁决          |

投影必须下推 Tenant、Project、Version、安全等级和策略版本过滤，但返回、下载、导出与发布前仍由权威 AuthorizationService 复核。投影策略落后时必须 fail closed。

## 包依赖合同

```text
platform contracts
        ↑
system contracts
        ↑
system core
        ↑
system application ← system infra
        ↑                 ↑
transport adapters ──────┘
```

Core 必须纯净确定性；Application 承担用例、Ports 和 Capability Handler；Infra 实现数据库、对象存储、AI、搜索与 GIS 适配器；Apps 只负责组合与传输。

## 全局交付约束

- 中文为默认语言，英文路由、状态和能力同构。
- 所有系统共享 WISER Design System，并支持持久化的浅色/深色主题。
- 新增或升级的 npm 包使用实施时确认的最新兼容稳定版、精确版本与同一 lockfile。
- Docker 镜像使用实施时确认的最新兼容稳定 tag，并同时锁定 digest；禁止 `latest`。
- 每个行为先提交能以预期原因失败的测试，再提交最小实现；每个 Green 里程碑运行 `pnpm verify`。
- 已执行的数据库迁移保持不可变，只允许前向修复。

## 完成边界

重构完成意味着：原 EXCON 行为和历史兼容不回退；统一 Supabase Auth 生效；Data Foundation 从上传、扫描、解释、确定性转换、质量检查、权威提交到全部投影和 REST/GraphQL/MCP/Web 查询真实可运行；统一文档、UI、主题、可观测性和 CI 全部通过。
