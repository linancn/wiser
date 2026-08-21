---
title: 快速开始
description: 在本机验证 WISER 统一 Auth、Agent EXCON 与 Data Foundation 完整依赖 profile。
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 首次安装、验证或启动本机开发栈时
whenToUpdate:
  - 工具链、命令、端口或本机服务入口变化时
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
lastReviewedAt: 2026-08-22
lastReviewedCommit: b2b07c3d5840e6a27613128f0f1d34f05d071cbf
---

## 先认识当前边界

当前默认开发协议是 `/api/v2`，Agent EXCON Skill 与 MCP 也默认使用 v2。Fastify 已实现多场景、RunAgent `/sync`、Task 租约、Message/Artifact、Submission/endorsement 和安全回放，但使用**内存协议适配器**；Supabase v2 schema/RLS 已交付，尚未由 API 使用。因此进程重启会丢失 v2 API 状态，本页展示的是协议/TDD/本地调试纵切，不是持久化生产部署。

v1 Episode 仍可运行，但只能显式选择 compatibility 模式；它目前不是 v2 事实之上的 facade，v2 失败也不会触发自动降级。

Data Foundation 已交付独立权威数据库/S3 adapter、纯领域规则、通用持久 Job runtime 与完整依赖 profile；具体投影消费者和 REST/GraphQL/MCP/Skill/Web 的最终纵切仍未完成。本页的数据 smoke 在当前里程碑验证真实镜像健康、WISER/pgSTAC migration、确定性 seed、API readiness 与 22 项 Capability，不应被解释为最终 18 步入库验收。

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

## 文档治理

仓库使用 Docpact 0.1.9 把实现路径映射到必须阅读、更新或显式审查的文档。先安装 CLI；编码前查询路由，编码后检查未暂存的工作区变更：

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'packages/core/src/**'
pnpm docpact:check
```

修改 `.docpact/config.yaml` 或 CI 后运行 `pnpm docpact:validate`。PR 检查会阻断未满足的文档义务和未被规则覆盖的实现变更。

只验证当前 v2 多智能体协议纵切：

```bash
pnpm --filter @agent-excon/contracts test
pnpm --filter @agent-excon/core test
pnpm --filter @wiser/api test
pnpm --filter @wiser/mcp test
node skills/agent-excon/scripts/lint-skill.mjs
```

这些测试覆盖多角色 quorum、Task/Barrier 状态、Receipt chain、`/sync`、Task lease、Message/Artifact、Submission/endorsement、Receipt-gated Submission 安全恢复、确定性 evaluator → rework → resubmit、参训者安全回放和 MCP→HTTP 映射。完整闭环已在本机内存 profile 交付；PostgreSQL 持久化 adapter 尚未接入。

## 统一 Auth 模式

非生产默认 `WISER_AUTH_MODE=off`，保留现有 EXCON 本机 token 兼容入口。要启用统一 Supabase 身份纵切，配置：

```dotenv
WISER_AUTH_MODE=supabase
SUPABASE_URL=http://127.0.0.1:56321
SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
WISER_DELEGATED_CREDENTIAL_HMAC_KEYS='{"activeKeyId":"primary-local","keys":{"primary-local":"<unpadded-base64url-of-32+-random-bytes>"}}'
```

每个 HMAC key 必须来自至少 32 个密码学安全随机字节，并将整段 JSON 只保留在服务端。Key ring 缺失、过短、带 padding 或格式畸形时 API 会拒绝启动；浏览器永远不能接收该值。

生产环境默认强制 `supabase`，缺少任一变量会失败关闭。浏览器只使用 `NEXT_PUBLIC_SUPABASE_*`；服务器变量和数据库连接不得加 `NEXT_PUBLIC_`。

## 启动 Data Foundation profile

复制环境模板，为所有留空的 credential 生成本机专用随机值；不要提交 `.env`：

```bash
cp .env.example .env
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
```

`data:up` 会构建共享 WISER 应用镜像，并启动默认服务及 `data-foundation` profile。镜像直接锁定 tag+digest；OpenSearch ICU 初始化还验证官方 artifact 的 SHA-512。GeoServer 与 PostgreSQL 18/PostGIS 3.6 官方镜像目前仅有 amd64，因此 Apple Silicon 通过 Compose 显式模拟；其余核心镜像使用原生 arm64。

| 数据服务              | 本机入口                             |
| --------------------- | ------------------------------------ |
| data-postgres         | `127.0.0.1:55432`                    |
| SeaweedFS S3          | `http://127.0.0.1:18333`             |
| Weaviate              | `http://127.0.0.1:18080`             |
| OpenSearch            | `https://127.0.0.1:19200`            |
| OpenSearch Dashboards | `http://127.0.0.1:15601`             |
| Neo4j HTTP            | `http://127.0.0.1:17474`             |
| GeoServer             | `http://127.0.0.1:18081/geoserver`   |
| STAC API              | `http://127.0.0.1:18082`             |
| TiTiler               | `http://127.0.0.1:18000`             |
| Martin                | `http://127.0.0.1:13000`             |
| Tika                  | `http://127.0.0.1:19998`             |
| ClamAV                | `127.0.0.1:13310`                    |
| Data Worker health    | `http://127.0.0.1:13003/health/live` |
| MCP Streamable HTTP   | `http://127.0.0.1:13004/mcp`         |

普通停止保留数据：

```bash
pnpm data:down
```

只有确实要删除 Data Foundation 的受控命名卷时才运行：

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

脚本先核对 Compose project 与精确 allowlist，不会删除 Supabase 或 observability 卷。

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

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
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
