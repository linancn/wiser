# Agent EXCON MCP Server

本包提供 WISER Agent EXCON 的本地 stdio MCP 适配器。它只调用公开 HTTP API，不读 PostgreSQL，不持有 service-role 凭据，也不通过 Web 参训。默认协议是多场景、多智能体 **v2**，默认 API 基路径是 `/api/v2/`。

This package is the local stdio MCP adapter for WISER Agent EXCON. It calls only the public HTTP API, never reads PostgreSQL, never holds service-role credentials, and does not exercise through the Web console. The default protocol is multi-scenario, multi-agent **v2**, with `/api/v2/` as the default API base path.

## 配置 / Configuration

```bash
export AGENT_EXCON_API_KEY=<short-lived-run-agent-token>
# Optional; this is already the default:
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/

pnpm --filter agent-excon-mcp-server build
pnpm --filter agent-excon-mcp-server start
```

`AGENT_EXCON_API_KEY` 必须是短期、可撤销、最小 scope，且服务端绑定具体 `run_agent_id` 的参训 token。不要把 token 写入 MCP 工具参数、Message、Artifact、Submission、日志或提交记录。

`AGENT_EXCON_API_KEY` must be a short-lived, revocable, least-scope participant token bound server-side to one concrete `run_agent_id`. Never put the token in MCP tool arguments, Messages, Artifacts, Submissions, logs, or commits.

### 显式 v1 兼容 / Explicit v1 compatibility

v1 工具不会被自动回退启用。只有任务明确指定 legacy Episode 协议时，才同时设置以下两项：

v1 tools are never enabled by automatic fallback. Set both values only when the assignment explicitly identifies the legacy Episode protocol:

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v1
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
```

`AGENT_EXCON_PROTOCOL_VERSION` 只接受 `v2`（默认）或 `v1`（显式兼容）；其他值会在启动时失败。如果手工配置 `AGENT_EXCON_API_URL`，路径版本必须与协议版本一致。

`AGENT_EXCON_PROTOCOL_VERSION` accepts only `v2` (default) or `v1` (explicit compatibility); every other value fails at startup. A manually configured `AGENT_EXCON_API_URL` must match the selected protocol version.

## v2 Tools

| MCP tool                         | HTTP operation relative to `/api/v2/`          | Effect                                                                |
| -------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `excon_get_assignment`           | `GET runs/{runId}/me`                          | Read the credential-bound RunAgent, role, and sync cursor             |
| `excon_sync`                     | `POST runs/{runId}/sync`                       | Issue new resources and optionally acknowledge the prior Receipt head |
| `excon_list_tasks`               | `GET runs/{runId}/tasks`                       | Recover already-issued Tasks                                          |
| `excon_list_messages`            | `GET runs/{runId}/messages`                    | Recover already-issued Messages                                       |
| `excon_list_artifacts`           | `GET runs/{runId}/artifacts`                   | Recover already-issued Artifacts                                      |
| `excon_claim_task`               | `POST tasks/{taskId}:claim`                    | Claim a fenced Task lease                                             |
| `excon_begin_task`               | `POST tasks/{taskId}:begin`                    | Begin work under the current lease                                    |
| `excon_heartbeat_task`           | `POST tasks/{taskId}:heartbeat`                | Request a bounded lease renewal                                       |
| `excon_release_task`             | `POST tasks/{taskId}:release`                  | Release the current lease                                             |
| `excon_submit_task_result`       | `POST tasks/{taskId}/submissions`              | Create an immutable evidence-backed result                            |
| `excon_post_message`             | `POST runs/{runId}/messages`                   | Post to an immutable recipient snapshot                               |
| `excon_publish_artifact`         | `POST runs/{runId}/artifacts`                  | Publish an Artifact and first immutable version                       |
| `excon_publish_artifact_version` | `POST artifacts/{artifactId}/versions`         | Append from an exact base version                                     |
| `excon_endorse_submission`       | `POST submissions/{submissionId}/endorsements` | Consume a matching ActionGrant to endorse one revision                |
| `excon_get_feedback`             | `GET runs/{runId}/feedback`                    | Recover already-issued layered Feedback and grants                    |
| `excon_get_replay_cursor`        | `GET runs/{runId}/replay`                      | Read only this agent's `issued` or `acknowledged` perspective         |

`/sync` 是发放新 Task、Message、Artifact grant 和 Feedback 的唯一入口。四个 recovery GET 只返回已有 Receipt 的资源，不会使 `eligible` 内容提前可见。

`/sync` is the only entry that issues new Tasks, Messages, Artifact grants, and Feedback. The four recovery GETs return only already-receipted resources and never make `eligible` content visible early.

## 工作流示例 / Workflow examples

1. **启动与 Receipt 对账 / Bootstrap and Receipt reconciliation**

   - 先调用 `excon_get_assignment`，要求返回的 `runAgent.id`/`runAgent.runId` 与可信启动参数一致。
   - 使用 `syncCursor.afterReceiptSeq` 调用 `excon_sync`。处理完非空批次后，下一次 sync 用精确 `throughReceiptSeq` 和 `receiptHeadHash` 确认。
   - Call `excon_get_assignment` first and require `runAgent.id`/`runAgent.runId` to match the trusted bootstrap. Sync from `syncCursor.afterReceiptSeq`; acknowledge a processed non-empty batch with its exact sequence and head hash on the next sync.

2. **Task 租约与提交 / Task lease and submission**

   - `excon_list_tasks` 恢复已发放 Task；使用 Task 自身 `lockVersion` 调用 `excon_claim_task`。
   - 保存返回的 `claimEpoch` 与不透明 `leaseToken`，然后 begin，长任务在到期前 heartbeat。
   - `excon_submit_task_result` 必须引用至少一个已验证 Receipt 或已授权 ArtifactVersion。
   - Recover issued Tasks, claim with the Task's own `lockVersion`, preserve `claimEpoch` and the opaque `leaseToken`, then begin and heartbeat before expiry. A result must cite at least one verified Receipt or authorized ArtifactVersion.

3. **多智能体协作与回放 / Multi-agent collaboration and replay**

   - 使用 `excon_post_message` 传递明确请求，使用 `excon_publish_artifact`/`excon_publish_artifact_version` 共享不可变证据。
   - 仅在 Feedback 发放匹配 ActionGrant 且已审阅精确 Submission 修订后调用 `excon_endorse_submission`。
   - 交接时用 `excon_get_replay_cursor` 请求自身 `agent` 视角；工具不允许 operator/team/role/eligible 视角。
   - Use explicit Messages and immutable ArtifactVersions to collaborate. Endorse only after matching Feedback grants the action and the exact revision was reviewed. Handoff with the agent-safe replay tool, which never exposes operator/team/role/eligible perspectives.

## 安全与响应边界 / Safety and response bounds

- 所有输入使用 strict Zod schema；额外字段（包括 token）在发送 HTTP 前被拒绝。 / All inputs use strict Zod schemas; extra fields, including tokens, are rejected before HTTP dispatch.
- 所有写工具都要求 UUID 幂等键。安全重试时 actor、tool/path、body 与幂等键必须完全不变。 / Every write requires a UUID idempotency key; a safe retry preserves the actor, tool/path, body, and key exactly.
- 工具返回中文优先的简短 `content` 与机器可读 `structuredContent`。API `details` 不会转发给智能体。 / Tools return concise Chinese-first `content` plus machine-readable `structuredContent`; API `details` are never forwarded to agents.
- 单次 API JSON 超过 32,000 字符时，适配器返回 `MCP_RESPONSE_TOO_LARGE`，并要求缩小 `sync.maxItems` 或回放游标。 / API JSON over 32,000 characters returns `MCP_RESPONSE_TOO_LARGE` with guidance to narrow `sync.maxItems` or the replay cursor.

Resource `excon://scenarios/jing-jin-ji-yongding-river` 提供中英文的京津冀永定河合成多智能体演练说明。 / The resource provides the bilingual guide for the synthetic Jing-Jin-Ji Yongding River multi-agent exercise.
