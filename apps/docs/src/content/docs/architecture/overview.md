---
title: 总体架构
description: 控制面、协议 API、导调领域、Supabase、AI 与 MCP 的职责边界。
---

## 设计原则

Agent EXCON 把不确定的智能体行为放在确定性的环境边界之外。状态转换、权限、证据可见性、事件记录和基础裁决必须由可测试代码与数据库约束完成。

```text
参训智能体 ── HTTP / SDK / MCP ──► 协议 API
                                      │
Next.js 控制台 ────────────────────────┤
                                      ▼
                         导调领域服务与状态机
                            │           │
                            ▼           ▼
                    PostgreSQL       评价适配器
                    Auth / RLS       规则 / AI / 人工
                    Storage
```

## 进程与职责

| 组件                | 负责                                     | 不负责                       |
| ------------------- | ---------------------------------------- | ---------------------------- |
| Next.js Web         | 中文默认控制台、人工裁决、回放与对比     | 长任务、公共协议实现         |
| Fastify API         | `/api/v1`、认证、幂等、OpenAPI、事务边界 | 页面渲染、模型内部策略       |
| Worker              | 异步评价、重试、结果接入                 | 直接绕过领域状态机修改数据   |
| PostgreSQL/Supabase | 事实数据、行锁、RLS、Auth、Storage       | 生成自然语言裁决             |
| AI adapters         | Codex 与 OpenAI-compatible 调用          | 决定数据权限或覆盖确定性规则 |
| MCP Server          | 把稳定 HTTP 操作映射为 Tools/Resources   | 复制业务逻辑或直接访问数据库 |

## 统一类型体系

`packages/contracts` 中的 Zod schema 是唯一协议源，同时用于：

- Fastify 请求和响应校验；
- OpenAPI 文档；
- Web 表单；
- Worker job payload；
- TypeScript SDK；
- MCP Tool 输入输出；
- fixtures 和契约测试。

数据库 schema 仍以 SQL migration 为准。Zod 不能代替外键、唯一约束、检查约束和事务。

## PostgreSQL 协作

普通行级访问使用 Supabase SDK；复杂事务、`FOR UPDATE`、`SKIP LOCKED` 和批量操作使用 `pg` 与显式 SQL/RPC。初期队列是 PostgreSQL 状态表，不引入 Redis。

每次状态改变和对应 Event 必须在同一事务提交，防止“状态已变但审计事件缺失”。

## AI 双适配器

- **Codex local**：开发和调试默认值，在宿主机运行并使用 ChatGPT 订阅登录。
- **OpenAI-compatible**：部署与跨提供商模式，固定 `baseURL`、模型和能力集。
- **Fake**：单元、集成和 CI 默认值，完全确定性。

适配器返回统一的使用量、耗时、模型标识和 trace metadata；业务逻辑不读取供应商私有响应结构。

## Compose 运维边界

Supabase 采用官方 compose 的固定 commit 和整套镜像。应用 compose 通过多文件叠加接入，不单独升级 Auth、PostgREST、Storage 或数据库镜像。analytics/vector 保持可选 profile，首切片不启用。

本次初始化核定的上游基线是 Supabase 官方仓库 commit [`9ae6e54`](https://github.com/supabase/supabase/commit/9ae6e54dd585fb7f71dfc6917ab9fc09fe3a408a)，其中数据库为 `supabase/postgres:17.6.1.136`，网关为 `envoyproxy/envoy:v1.39.0`。仓库实际 compose 文件是运行时权威来源；更新时必须整体核对该 commit 中的所有镜像，而不是只复制这两个标签。

新环境直接从 PostgreSQL 17 初始化。若以后导入 PostgreSQL 15 数据，先按 [Supabase 官方升级指南](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17) 备份并演练升级，不允许直接复用旧数据卷启动 PG17。
