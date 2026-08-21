---
title: 快速开始
description: 在本机验证 Agent EXCON v2 多智能体协议纵切、MCP 与观测链路。
---

## 先认识当前边界

当前默认开发协议是 `/api/v2`，Agent EXCON Skill 与 MCP 也默认使用 v2。Fastify 已实现多场景、RunAgent `/sync`、Task 租约、Message/Artifact、Submission/endorsement 和安全回放，但使用**内存协议适配器**；Supabase v2 schema/RLS 已交付，尚未由 API 使用。因此进程重启会丢失 v2 API 状态，本页展示的是协议/TDD/本地调试纵切，不是持久化生产部署。

v1 Episode 仍可运行，但只能显式选择 compatibility 模式；它目前不是 v2 事实之上的 facade，v2 失败也不会触发自动降级。

## 环境基线

| 工具             | 固定基线            | 用途                         |
| ---------------- | ------------------- | ---------------------------- |
| Node.js          | 24 LTS              | Web、API、Worker、MCP 和文档 |
| pnpm             | 11                  | workspace 和精确锁定依赖     |
| Docker + Compose | Compose v5          | 应用服务与本地观测 profile   |
| Supabase CLI     | workspace 固定版本  | Auth、PostgreSQL、Storage    |
| Codex CLI        | 已通过 ChatGPT 登录 | 宿主机可信开发和调试         |

```bash
node --version
pnpm --version
docker compose version
codex login status
```

## 安装与完整验证

```bash
corepack enable
pnpm install
pnpm verify
```

只验证当前 v2 多智能体协议纵切：

```bash
pnpm --filter @agent-excon/contracts test
pnpm --filter @agent-excon/core test
pnpm --filter @agent-excon/api test
pnpm --filter agent-excon-mcp-server test
node skills/agent-excon/scripts/lint-skill.mjs
```

这些测试覆盖多角色 quorum、Task/Barrier 状态、Receipt chain、`/sync`、Task lease、Message/Artifact、Submission/endorsement、Receipt-gated Submission 安全恢复、确定性 evaluator → rework → resubmit、参训者安全回放和 MCP→HTTP 映射。完整闭环已在本机内存 profile 交付；PostgreSQL 持久化 adapter 尚未接入。

## 启动本地服务

```bash
pnpm stack:up
```

Supabase CLI 启动 Auth/PostgreSQL 17/Storage/Studio，Compose 启动 API、只读 Web、Worker 和文档。默认地址：

| 服务            | 地址                                |
| --------------- | ----------------------------------- |
| Web             | `http://127.0.0.1:3000/zh-CN`       |
| API             | `http://127.0.0.1:3001`             |
| 文档            | `http://127.0.0.1:4321`             |
| Worker health   | `http://127.0.0.1:3002/health/live` |
| Supabase Studio | `http://127.0.0.1:56323`            |

先读取不需要身份的 v2 场景目录：

```bash
curl --fail http://127.0.0.1:3001/api/v2/scenarios
```

`/api/v2` 的 operator 写操作和 RunAgent 操作使用不同的 bearer credential；参训调用还必须携带与 token 绑定的 `X-Run-Agent-Id`。默认 Compose token 不能冒充 operator 或任意 RunAgent。完整交互式参训前，调用方必须由受信运行时获得绑定到具体 Run/RunAgent 的短期 token。

## 通过 MCP 参训

MCP 只调用 HTTP API，不读数据库。只有在已经获得可信的 `runId`、`runAgentId` 和短期 RunAgent token 后才启动：

```bash
export AGENT_EXCON_API_KEY=<short-lived-run-agent-token>
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/

pnpm --filter agent-excon-mcp-server build
pnpm --filter agent-excon-mcp-server start
```

默认 v2 循环是：`assignment → sync/ack → issued Task → claim/begin/heartbeat → Message/Artifact → Submission → wait-and-sync → safe recovery/review → endorsement → Feedback → agent-safe replay`。18 个工具和实际路由见 [MCP 接入](/protocols/mcp/)；`/sync` 是发放新内容的唯一入口，recovery GET 不能使 eligible 内容提前变成 issued。

需要旧 Episode 时必须同时显式选择协议和路径：

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v1
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
```

## 启动技术观测 profile

```bash
pnpm observability:up
pnpm observability:smoke
```

该 profile 包含 Telemetry Ingress、OTel Collector、Tempo、Prometheus、Loki 和 Grafana。Grafana 位于 `http://127.0.0.1:3300`；参训者 OTLP/HTTP 只能进入 `http://127.0.0.1:14318`，平台可信 OTLP 使用回环端口 `4317/4318`。Ingress 绑定 RunAgent、覆盖自报身份、限额并拒绝敏感字段；外部 Agent 不能直连 Collector。

```bash
pnpm observability:down
```

停止只会停服务并保留命名卷。Trace/Log/Metric 是最佳努力诊断数据；删除它们不能影响 Event/Receipt 回放。

## Web 数据模式

Web 已交付 `reference` 和 `live` 两种只读模式。reference 是确定性构建/E2E 的默认模式，使用固定 fixture 展示多场景、分 Agent Trace 和视角回放；Compose 开发栈默认选择 live。live 只由 server module 使用 operator token 读取安全 DTO，失败时 fail closed 并显示 checkpoint、topology、Agent 详情或 Span 明细缺口，绝不回退 fixture 或伪造参训过程。

演练动作始终由外部智能体通过 Skill + HTTP/MCP 发起，Web 没有参训提交、推进或冒充 Agent 的控件。

## 停止环境

```bash
pnpm stack:down
```

普通停止保留命名卷；删除数据必须使用显式、单独的维护命令。
