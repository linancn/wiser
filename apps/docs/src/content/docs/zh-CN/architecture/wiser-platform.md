---
title: WISER 多系统平台
description: WISER、Agent EXCON、Data Foundation 与共享宿主的长期系统边界。
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
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

## 决策摘要

WISER 是产品与平台总上下文。Agent EXCON 与 Data Foundation 是平级的业务系统，不是彼此内部的功能目录。它们复用同一套 Fastify、Next.js、MCP、Fumadocs、Supabase Auth 和可观测性入口，同时保留各自的领域模型、应用用例、Worker 与权威事实。

组合根接入统一 Supabase Auth、平台身份/委托模块、持久化 EXCON v2 command journal、Data Capability、REST、GraphQL、MCP/Skill、系统 Worker、投影和双语 Web。`pnpm stack:full:up` 在同一平台身份边界下启动默认完整栈并执行 Data smoke；v1 Episode 是显式内存 compatibility，不代表统一平台的持久化路径。

“统一身份”表示同一 Supabase/Platform 权威和授权上下文，不表示所有客户端复用一枚交互式 credential。Data Web 使用用户的 Supabase SSR Session；EXCON live Web 使用服务端 operator credential；MCP transport bearer、EXCON RunAgent credential 与 Data API identity 各自承担不同边界，不能互换。

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

| 存储/服务                      | 权威内容                                          | 一致性规则                                  |
| ------------------------------ | ------------------------------------------------- | ------------------------------------------- |
| Supabase Auth/PostgreSQL       | 用户、Session、租户、项目、Membership、EXCON 事实 | 单一 WISER 身份与控制面                     |
| data-postgres/PostGIS          | DataItem、版本、质量、血缘、Operation、Outbox     | Data Foundation 结构化权威面                |
| S3 兼容对象存储                | 原始对象和不可变版本资产                          | 内容寻址、校验后由 PostgreSQL manifest 提交 |
| OpenSearch/Weaviate/Neo4j/STAC | 检索、图谱与外部 GIS 投影                         | 可清空、可重建、幂等、非授权权威            |
| GeoServer/TiTiler/Martin       | 无；只提供 Compose-internal GIS serving           | 固定 origin、无 host port、所有访问经 API   |
| OpenTelemetry                  | 技术诊断投影                                      | 可采样，不参与业务状态、权限或裁决          |

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

## 平台级合同

- 产品入口遵循 `WISER Portal → 业务系统 → 系统工作区 → 领域对象`。Portal 负责平台介绍与统一登录，不是第三个业务系统；数据基座在一级导航中排在智能体演练场之前。
- 中文为默认语言，英文路由、状态和能力同构。
- 所有系统共享 WISER Design System，并支持持久化的浅色/深色主题。
- 新增或升级的 npm 包使用实施时确认的最新兼容稳定版、精确版本与同一 lockfile。
- Docker 镜像使用实施时确认的最新兼容稳定 tag，并同时锁定 digest；禁止 `latest`。
- 每个行为先提交能以预期原因失败的测试，再提交最小实现；每个 Green 里程碑运行 `pnpm verify`。
- 已执行的数据库迁移保持不可变，只允许前向修复。

## 验证边界

平台边界通过可执行命令证明，而不是靠文档宣称。`pnpm verify` 覆盖格式、lint、类型、单元/组件测试、build 与 Compose config；Supabase、Data、浏览器、可观测性和文档治理还有各自的聚焦门禁。完整矩阵见[测试与验证](/development/testing/)。
