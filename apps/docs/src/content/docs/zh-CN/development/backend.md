---
title: 后端开发
description: 共享 Fastify API、EXCON v1 compatibility Worker、Data Worker、MCP 与 Telemetry Ingress 的源码入口和聚焦工作流。
docType: runbook
scope: wiser-backend
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 WISER 后端路由、应用服务、Worker、MCP 或遥测入口时
  - 选择后端聚焦测试和健康检查时
whenToUpdate:
  - 后端进程、模块注册、路由前缀、端口或 workspace 命令变化时
checkPaths:
  - apps/api/**
  - apps/worker/**
  - apps/data-worker/**
  - apps/mcp/**
  - apps/telemetry-ingress/**
  - packages/**
  - compose.yaml
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## 后端拓扑

WISER 没有为每个系统复制一套公网 API。Platform、Agent EXCON 和 Data Foundation 组合进同一个 Fastify 进程；长任务、MCP 和参与者遥测由独立进程承担。

```text
Web / external clients / Skills
              │
              ▼
       @wiser/api :3001
       ├── /api/platform/v1   unified identity and delegation
       ├── /api/v2            Agent EXCON
       ├── /api/data/v1       Data Foundation REST/resources/GIS
       └── /graphql           Data Foundation GraphQL
              │
       ┌──────┼─────────────┐
       ▼      ▼             ▼
 EXCON Worker Data Worker  authority stores

MCP gateway ──HTTP────────► @wiser/api
Telemetry Ingress ────────► internal OTel Collector
```

## 进程与源码入口

| 进程                          | 入口                                 | 聚焦启动                                          | 本机入口与健康检查                                                     |
| ----------------------------- | ------------------------------------ | ------------------------------------------------- | ---------------------------------------------------------------------- |
| 共享 API `@wiser/api`         | `apps/api/src/main.ts`、`app.ts`     | `pnpm --filter @wiser/api dev`                    | 默认 `3001`；`/health/live`、`/health/ready`、`/openapi.json`          |
| EXCON v1 compatibility Worker | `apps/worker/src/main.ts`            | `pnpm --filter @agent-excon/worker dev`           | 默认 health `8081`、Compose `3002`；默认 API 不 enqueue                |
| Data Worker                   | `apps/data-worker/src/main.ts`       | `pnpm --filter @wiser/data-worker dev`            | `/health/live`、`/health/ready`、`/metrics`；完整栈映射 `13003`        |
| MCP stdio                     | `apps/mcp/src/index.ts`              | 先 build，再运行 `pnpm --filter @wiser/mcp start` | stdio，无 HTTP 端口                                                    |
| MCP HTTP                      | `apps/mcp/src/http-main.ts`          | `pnpm --filter @wiser/mcp dev:http`               | `/mcp`、`/health/live`、`/health/ready`；完整栈映射 `13004`            |
| Telemetry Ingress             | `apps/telemetry-ingress/src/main.ts` | `pnpm --filter @wiser/telemetry-ingress dev`      | `/v1/traces`、`/v1/metrics`、`/v1/logs`；可观测性 profile 映射 `14318` |

端口表中的完整栈地址来自 Compose 映射，独立进程默认值可能不同。需要与完整平台相同的身份、数据库和依赖时，不要手工拼环境变量，使用 `pnpm stack:full:up`；所有端口和停止方式见[本机开发环境](/development/local-environment/)。

## 共享 Fastify API

### 组合顺序

`apps/api/src/main.ts` 是生产入口：

1. `createV2RuntimeFromEnvironment` 建立 Agent EXCON v2 内存或 PostgreSQL journal 运行时。
2. `createPlatformAuthRuntimeFromEnvironment` 建立统一 Platform credential resolver 和平台模块。
3. `buildApp` 注册通用错误 envelope、CORS、OpenAPI、健康端点、EXCON v1 compatibility 与 `/api/v2`。
4. `createDataFoundationRuntimeFromEnvironment` 建立 Data adapter，并由 `registerWiserApiModules` 挂载其模块。
5. Fastify `onClose` hook 关闭数据库连接、对象存储 client 和其他资源。

业务模块实现 `WiserApiModule`。模块 ID 必须是唯一的点分小写名称，例如 `data.foundation`；模块在自己的作用域注册路由，不能绕过组合根启动第二个公共 API。

### 路由所有权

| 路由                 | 所有者                                            | 主要源码                                         |
| -------------------- | ------------------------------------------------- | ------------------------------------------------ |
| `/api/platform/v1/*` | WISER Platform                                    | `apps/api/src/platform/`                         |
| `/api/v2/*`          | Agent EXCON v2                                    | `apps/api/src/v2-routes.ts` 与 `v2-*` 应用服务   |
| `/api/v1/*`          | Agent EXCON v1 compatibility                      | `apps/api/src/app.ts`；仅本机内存兼容路径        |
| `/api/data/v1/*`     | Data Foundation REST、Capability、Resource 和 GIS | `apps/api/src/data-foundation/`                  |
| `/graphql`           | Data Foundation schema-first GraphQL              | `apps/api/src/data-foundation/graphql-module.ts` |

`/health/ready` 验证 API 自身的 EXCON 服务；Data Foundation 另有 `/api/data/v1/health`，会分别反映数据库、对象存储和 Data Worker。不要用一个 liveness 结果代替完整依赖就绪证明。

### 身份和运行模式

- Supabase Auth 是人类 Session 的唯一身份源；平台 resolver 同时接受经授权的委托凭据。
- 生产环境强制 `WISER_AUTH_MODE=supabase`。非生产可以显式使用 `off`，但 Data Foundation 在 Auth 关闭时拒绝启动。
- Platform 请求上下文包含 Tenant、Project、Purpose、roles、scopes、安全上限和 authz version。系统 adapter 必须从该上下文授权，不能只检查“已登录”。
- Agent EXCON 把 Platform roles 映射为 operator/run_agent；run_agent credential 还必须绑定具体 RunAgent。
- 浏览器可见配置只包含 publishable Supabase 值。数据库 DSN、operator credential、S3 key、HMAC key 和 MCP token 只留在服务端。

配置名和完整运行组合以 `.env.example`、运行时 config loader 和 `compose.yaml` 为准。不要在文档或代码中添加第二套身份表或隐式 fallback token。

## Workers

### Agent EXCON v1 compatibility Worker

`apps/worker` 消费 `excon_private.evaluation_jobs`，读取 v1 `episodes/submissions` 并执行确定性评价。默认 API 的 v1 是进程内 memory service，v2 在 API service/journal replay 内评价，两者都不向此 Worker enqueue；因此它只用于 PostgreSQL-backed v1 compatibility/testing。`DATABASE_URL` 是必需项；领取数量、lease、轮询和 health 可通过 `WORKER_*` 调整。

修改评价输入时，同时检查：

- `@agent-excon/core` 的确定性规则；
- `apps/worker/src/evaluation-input.ts` 的安全输入投影；
- PostgreSQL repository 的 claim/lease 语义；
- API 对 evaluation 状态的读取。

### Data Worker

`apps/data-worker` 组合两类工作：受控入库 handler，以及权威 Outbox 的 completion targets。`POSTGIS` 在 data-postgres 内建立受治理 spatial readiness；Weaviate、OpenSearch、Neo4j 与 STAC 是可重建外部投影。Worker 只用受限 Data runtime role 访问独立 Data PostgreSQL，并通过对象存储和内部服务 adapter 工作。

配置由 `apps/data-worker/src/config.ts` 严格校验。优先使用规范的 `DATA_*` 名称；兼容 alias 只用于迁移，会在启动时告警。Worker 的 `/metrics` 是 Prometheus 文本，不是业务事实源。

## MCP 网关

`@wiser/mcp` 同时提供 stdio 与无状态 Streamable HTTP transport。系统能力通过 `WiserMcpModule` 注册；当前 EXCON 与 Data 模块都使用受限 HTTP client 调用 `@wiser/api`。

必须保持以下边界：

- Tool 和 Resource schema 来自公开系统 contracts，输出有大小和结构校验；
- MCP 不导入 API application service，也不查询数据库、journal 或投影；
- HTTP transport 的 `/mcp` 自身需要 bearer token，下游 API 仍使用各系统的授权 credential；
- 新模块必须有唯一点分 ID，并通过 `registerWiserMcpModules` 组合。

## Telemetry Ingress

`@wiser/telemetry-ingress` 只接收 OTLP JSON 的 traces、metrics 和 logs。它验证参与者遥测 credential，覆盖客户端自报的受保护身份属性，拒绝 prompt、completion、Tool body 和隐藏 outcome 等敏感字段，然后转发到内部 Collector。

本机 demo 可以显式配置长随机 local token 和 Run/RunAgent ID；其他模式必须使用 PostgreSQL credential verifier 和 token pepper。Collector 不应直接暴露为外部 Agent 的可信入口，遥测也不能替代 Domain Event、Receipt 或审计事实。

## 修改后端的一次聚焦循环

1. 用公开行为写失败测试。纯规则放到 core 测试；路由用 Fastify `inject()`；Worker 用端口 fake；MCP 用 fake HTTP client。
2. 若协议变化，先更新系统 contracts 和兼容性测试，再更新 application 与 adapter。
3. 让应用层返回稳定领域结果；在 Fastify/MCP 边界映射状态码、错误 envelope 和可操作提示。
4. 写操作使用幂等键、事务、唯一约束与并发控制；不要依赖进程内锁证明数据库语义。
5. 先运行拥有该行为的 workspace 测试，再运行直接消费者，最后运行根验证。

常用聚焦命令：

```bash
pnpm --filter @wiser/api test
pnpm --filter @agent-excon/worker test
pnpm --filter @wiser/data-worker test
pnpm --filter @wiser/mcp test
pnpm --filter @wiser/telemetry-ingress test

pnpm --filter @wiser/api typecheck
pnpm --filter @wiser/api build
```

按拥有事实的边界追加门禁，不要无条件运行两套数据库验证：

```bash
pnpm supabase:verify  # 仅 Supabase Auth/控制面/EXCON schema、RLS、seed；会 reset 本机 Supabase
pnpm data:verify      # 仅 Data contracts/core/infra/Worker/Compose 静态与 workspace 验证
pnpm data:smoke       # Data 真实数据库/对象/投影/API/MCP/Web 纵切，要求完整依赖已运行
pnpm verify           # 所需聚焦与集成门禁之后的全仓收敛
```

纯 EXCON 协议改动通常不需要 Data gate；纯 Data 改动也不应仅为“保险”清空 Supabase。只有跨系统身份或完整栈行为变化时才组合相应门禁。

新增业务系统和模块注册的完整清单见[新增 WISER 系统](/development/adding-a-system/)。
