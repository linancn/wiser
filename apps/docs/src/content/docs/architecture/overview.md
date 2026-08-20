---
title: 总体架构
description: 控制面、协议 API、导调领域、Supabase、AI 与 MCP 的职责边界。
---

## 设计原则

Agent EXCON 把不确定的智能体行为放在确定性的环境边界之外。状态转换、权限、证据可见性、事件记录和基础裁决必须由可测试代码与数据库约束完成。

```text
参训智能体 + Agent EXCON Skill ── HTTP / MCP ──► 协议 API
                                      │
Next.js 只读态势与 Trace 回放 ◄────────┤
                                      ▼
                         导调领域服务与状态机
                            │           │
                            ▼           ▼
                    PostgreSQL       评价适配器
                    Auth / RLS       规则 / AI / 人工
                    Storage
```

## 进程与职责

| 组件                | 负责                                       | 不负责                       |
| ------------------- | ------------------------------------------ | ---------------------------- |
| Next.js Web         | 中文默认案例可视化、态势、Trace 与只读回放 | 提交、推进或直接控制 Episode |
| Fastify API         | `/api/v1`、认证、幂等、OpenAPI、事务边界   | 页面渲染、模型内部策略       |
| Worker              | 异步评价、重试、结果接入                   | 直接绕过领域状态机修改数据   |
| PostgreSQL/Supabase | 事实数据、行锁、RLS、Auth、Storage         | 生成自然语言裁决             |
| AI adapters         | Codex 与 OpenAI-compatible 调用            | 决定数据权限或覆盖确定性规则 |
| MCP Server          | 把稳定 HTTP 操作映射为 Tools/Resources     | 复制业务逻辑或直接访问数据库 |

## 统一类型体系

`packages/contracts` 中的 Zod schema 是唯一协议源，同时用于：

- Fastify 请求和响应校验；
- OpenAPI 文档；
- Web 只读投影；
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

开发环境刻意分成两层：Supabase CLI 按官方兼容集合管理本地 Auth、PostgreSQL 17、Storage、PostgREST 与 Studio 容器；仓库 `compose.yaml` 管理 API、只读 Web、Worker 和文档。这样既保留 Compose 的应用级健康检查与统一启停，也避免手工复制一套会随 Supabase 上游网关和镜像变化而漂移的半自托管配置。

生产环境使用 Supabase Platform，或整体固定官方 self-host Compose commit 与全部镜像；不得单独升级 Auth、数据库、Storage 或网关。导入旧 PostgreSQL 15 数据前，必须按 [Supabase 官方升级指南](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17) 备份并演练，不能直接让 PG17 复用旧数据卷。
