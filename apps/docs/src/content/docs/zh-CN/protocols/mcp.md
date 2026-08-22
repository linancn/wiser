---
title: MCP 接入
description: 通过本地 stdio 或带认证的无状态 Streamable HTTP，使用 18 个已实现的 v2 Tools 参训。
docType: protocol-reference
scope: mcp-adapter
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 通过 MCP 参训或修改 MCP 工具时
whenToUpdate:
  - 工具、HTTP 映射、凭据或版本选择变化时
checkPaths:
  - apps/mcp/**
  - apps/api/**
  - skills/agent-excon/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: fe6687b78bae4241b59c82280f4a97b2fcff05d3
---

## MCP 是 HTTP 适配器

MCP Server 只调用公开 HTTP API，不复制状态机、权限、Receipt 或裁决逻辑，不直连 PostgreSQL，也不持有 service-role credential。默认协议是多场景、多智能体 **v2**，默认 API 基路径是 `/api/v2/`。

当前 server 使用 `@modelcontextprotocol/sdk` v1 稳定线。本地客户端走 stdio，Compose 入口走带认证的无状态 Streamable HTTP。输入是 strict Zod schema；成功结果在中文优先的 `content` 中镜像紧凑 `MACHINE_DATA`，同时返回同一份机器可读 `structuredContent`，兼容只展示文本的 Agent 客户端。

## WISER 模块组合

Agent EXCON、Data Foundation 与未来系统复用同一个 MCP Server。每个系统通过静态 `WiserMcpModule` 注册 Tool/Resource；模块 ID 必须命名空间化且全局唯一，重复 ID 会在连接 transport 前失败。模块注册只组合协议面，所有业务调用仍必须经 HTTP API。

Data Foundation 模块在五个 `DATA_API_*`/scope 环境值完整提供时注册 22 个 Tool 与 5 个受控 Resource；部分配置会失败关闭，完全未配置则只运行 EXCON。Data Tool、双层 bearer、上传/Operation 流程和响应上限见 [Data MCP](/protocols/data-mcp/)。

## 配置

只有在可信 bootstrap 已提供 `runId`、`runAgentId` 和绑定到该实例的短期 token 后才启动：

```bash
export AGENT_EXCON_API_KEY=<short-lived-run-agent-token>
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

不要把 token 放入 Tool 参数、Message、Artifact、Submission、日志、遥测或 Git。MCP 启动不会注册 RunAgent，也不会把 operator credential 转换为参训身份。

### Streamable HTTP 入口

共享 Compose profile 在 `POST /mcp` 运行第二个入口。它要求一个只用于边界认证的 bearer，下游业务请求仍使用短期 `AGENT_EXCON_API_KEY`：

```bash
export DATA_MCP_BEARER_TOKEN=<至少-16-字符的随机密钥>
export DATA_MCP_HOST=127.0.0.1 # 可选；默认 0.0.0.0
export DATA_MCP_PORT=3100      # 可选

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start:http
```

`GET /health/live` 和 `GET /health/ready` 是无需认证且禁止缓存的探针。每个 `/mcp` 请求都创建新的 MCP server 与 transport；该无状态边界不发放或恢复 session。必须提供有效的 `Authorization: Bearer …` header，不接受 query token；优雅关闭先把 readiness 置为不健康，再排空在途请求。

## 已实现的 v2 Tools

下表与 `apps/mcp/src/server.ts` 及当前 Fastify 路由一一对应。HTTP 操作相对于 `/api/v2/`。

| MCP Tool                         | HTTP 操作                                      | 真实效果                                                |
| -------------------------------- | ---------------------------------------------- | ------------------------------------------------------- |
| `excon_get_assignment`           | `GET runs/{runId}/me`                          | 核对 credential 绑定的 RunAgent、角色和 sync cursor     |
| `excon_sync`                     | `POST runs/{runId}/sync`                       | 发放新资源并可确认上一 Receipt head                     |
| `excon_wait_and_sync`            | `POST runs/{runId}/sync`                       | 墙钟有界等待后执行一次普通 sync，不推进虚拟时钟         |
| `excon_list_tasks`               | `GET runs/{runId}/tasks`                       | 恢复已 issued Task                                      |
| `excon_list_messages`            | `GET runs/{runId}/messages`                    | 恢复已 issued Message                                   |
| `excon_list_artifacts`           | `GET runs/{runId}/artifacts`                   | 恢复已 issued Artifact grant                            |
| `excon_list_submissions`         | `GET runs/{runId}/submissions`                 | 恢复已 issued 的精确不可变 Submission 修订              |
| `excon_claim_task`               | `POST tasks/{taskId}:claim`                    | 领取 fenced Task lease；仅此工具返回不透明 token        |
| `excon_begin_task`               | `POST tasks/{taskId}:begin`                    | 以当前 lease 开始 Task                                  |
| `excon_heartbeat_task`           | `POST tasks/{taskId}:heartbeat`                | 请求有界 lease 续期                                     |
| `excon_release_task`             | `POST tasks/{taskId}:release`                  | 释放 lease 并使旧 token 失效                            |
| `excon_submit_task_result`       | `POST tasks/{taskId}/submissions`              | 创建带 Receipt/ArtifactVersion 证据的不可变结果         |
| `excon_post_message`             | `POST runs/{runId}/messages`                   | 发送 inform/request/response 或 ArtifactVersion handoff |
| `excon_publish_artifact`         | `POST runs/{runId}/artifacts`                  | 发布 Artifact 与不可变首版                              |
| `excon_publish_artifact_version` | `POST artifacts/{artifactId}/versions`         | 从精确 `baseVersionId` 追加版本                         |
| `excon_endorse_submission`       | `POST submissions/{submissionId}/endorsements` | 消费匹配 ActionGrant 背书精确修订                       |
| `excon_get_feedback`             | `GET runs/{runId}/feedback`                    | 恢复已 issued 的分层 Feedback/ActionGrant               |
| `excon_get_replay_cursor`        | `GET runs/{runId}/replay`                      | 只读取自身 `issued`/`acknowledged` agent 视角           |

`excon_list_submissions` 只恢复当前 RunAgent 已通过 `excon_sync` 获得 Receipt 的精确不可变修订。它不会泄露未发放或其他智能体的 Submission；背书前必须用本工具恢复并审阅目标修订。

## 推荐调用顺序

1. `excon_get_assignment`：返回的 RunAgent/Run/role 必须与可信 bootstrap 一致。
2. `excon_sync`：从持久化的 `afterReceiptSeq` 拉取；处理并验证非空批次后，在下一次 sync 确认精确 `throughReceiptSeq` 和 `receiptHeadHash`。
3. `excon_list_tasks`：只恢复已发放 Task；用 Task 自身 `lockVersion` claim。
4. 保存 claim 返回的 `claimEpoch`、`leaseToken` 和期限；begin，长任务在到期前有限 heartbeat。
5. 用 `request` 发起明确请求，用引用已收取父请求的 `response` 形成因果回复，用 `handoff` 固定 ArtifactVersion 交接。成功写入不代表收件人已知，收件人仍需自己的 sync Receipt；Receipt ack 也不等于理解或同意。
6. `excon_submit_task_result` 至少引用一个已验证的自身 Receipt 或已授权 ArtifactVersion。
7. 通过 `excon_sync` 获取 Submission Receipt，再用 `excon_list_submissions` 恢复并审阅精确不可变修订；只有收到匹配 ActionGrant 后才能 endorse。
8. 使用 `excon_wait_and_sync` 有界等待 Feedback/Barrier 下游 Task；参训者没有 Run 时钟推进或 Barrier release Tool。
9. 交接时使用 `excon_get_replay_cursor`，严格分开权威 Event/Receipt 与最佳努力 Telemetry gap。

`/sync` 是发放新 Task、Message、Artifact grant、Submission 与 Feedback 的唯一入口。五个 recovery Tools 不能把 eligible 内容变成 issued。

## 安全重试与响应边界

- 所有写 Tool 都要求 UUID `idempotencyKey`。模糊失败时只能以完全相同的 actor、Tool/path、body 和 key 重试。
- Task lease token 只保留在调用方本地状态；MCP Tool 不替调用方持久化它。
- API 错误映射为 `isError: true`，保留稳定 `code`、安全 message、下一步 action 和可选 trace ID；API `details` 不转发给智能体。
- Artifact/Message 较多时将 `sync maxItems` 收窄到约 8，并在 `hasMore=true` 时使用返回的连续 cursor 分页，避免 `MCP_RESPONSE_TOO_LARGE`。
- 单次完整 MCP 响应超过 32,000 字符时返回 `MCP_RESPONSE_TOO_LARGE`；缩小 `sync.maxItems` 或回放 cursor，不能截断后继续当作完整事实。
- RunAgent replay Tool 不提供 operator/team/role/eligible 视角。

本机 v2 Lab 可显式使用 memory profile。完整栈和生产使用 PostgreSQL append-only command journal：全部 19 个 v2 mutation 的 intent/outcome、canonical hash 与生成值 tape 可在重启时确定性重放；单 writer advisory lock、非超级用户 RLS、lease HMAC secret reference 和 replay-drift 检查均失败关闭。MCP 仍只是 HTTP adapter，不读取 journal。

## Resource

只读双语场景 Resource：

```text
excon://scenarios/jing-jin-ji-yongding-river
```

它说明事实锚定的合成京津冀永定河多智能体演练。Run、Receipt、Feedback 和 replay 仍经有身份的 Tools 读取；隐藏 Outcome、完整评价规则、未释放 Inject 和他人私有内容从不作为 Resource。

## 显式 v1 compatibility

v1 工具不会自动注册。只有任务明确指定 legacy Episode 时才同时设置：

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v1
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
```

此模式注册 9 个 legacy Tools：`excon_start_episode`、`excon_get_episode`、`excon_observe`、`excon_list_observations`、`excon_submit_allocation_plan`、`excon_get_evaluation`、`excon_get_feedback`、`excon_advance`、`excon_get_events`。不得把 v1 Episode、Observation、version 或 idempotency key 带入 v2 Run。
