---
title: Agent EXCON MCP adapter guide
docType: component-guide
scope: apps/mcp
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when changing, running, or integrating the MCP adapter
whenToUpdate:
  - when MCP tools, HTTP mappings, credentials, or protocol selection changes
checkPaths:
  - apps/mcp/**
  - apps/api/**
  - skills/agent-excon/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# Agent EXCON MCP Server

本包提供 WISER Agent EXCON 的本地 stdio MCP 适配器。它只调用公开 HTTP API，不读 PostgreSQL，不持有 service-role 凭据，也不通过 Web 参训。默认协议是多场景、多智能体 **v2**，默认 API 基路径是 `/api/v2/`。

This package is the local stdio MCP adapter for WISER Agent EXCON. It calls only the public HTTP API, never reads PostgreSQL, never holds service-role credentials, and does not exercise through the Web console. The default protocol is multi-scenario, multi-agent **v2**, with `/api/v2/` as the default API base path.

WISER systems extend the same server through explicit `WiserMcpModule` values. Module ids are statically registered, namespaced, and unique; duplicate ids fail before a transport connects. A module may register Tools and Resources, but every business operation still uses an HTTP client rather than importing application or database code.

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
| `excon_wait_and_sync`            | `POST runs/{runId}/sync`                       | Wait on wall time, then issue one normal sync without virtual advance |
| `excon_list_tasks`               | `GET runs/{runId}/tasks`                       | Recover already-issued Tasks                                          |
| `excon_list_messages`            | `GET runs/{runId}/messages`                    | Recover already-issued Messages                                       |
| `excon_list_artifacts`           | `GET runs/{runId}/artifacts`                   | Recover already-issued Artifacts                                      |
| `excon_list_submissions`         | `GET runs/{runId}/submissions`                 | Recover exact already-issued immutable Submission revisions           |
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

`/sync` 是发放新 Task、Message、Artifact grant、Submission 和 Feedback 的唯一入口。五个 recovery GET 只返回已有 Receipt 的资源，不会使 `eligible` 内容提前可见。

`/sync` is the only entry that issues new Tasks, Messages, Artifact grants, Submissions, and Feedback. The five recovery GETs return only already-receipted resources and never make `eligible` content visible early.

## 工作流示例 / Workflow examples

1. **启动与 Receipt 对账 / Bootstrap and Receipt reconciliation**

   - 先调用 `excon_get_assignment`，要求返回的 `runAgent.id`/`runAgent.runId` 与可信启动参数一致。
   - 使用 `syncCursor.afterReceiptSeq` 调用 `excon_sync`。处理完非空批次后，下一次 sync 用精确 `throughReceiptSeq` 和 `receiptHeadHash` 确认。
   - 等待 Barrier 时使用 `excon_wait_and_sync`，先按墙钟有界等待再执行一次普通 sync；它不推进虚拟时钟。
   - Call `excon_get_assignment` first and require `runAgent.id`/`runAgent.runId` to match the trusted bootstrap. Sync from `syncCursor.afterReceiptSeq`; acknowledge a processed non-empty batch with its exact sequence and head hash on the next sync.
   - Use `excon_wait_and_sync` at a Barrier to wait on wall time before one normal sync; it never advances virtual time.

2. **Task 租约与提交 / Task lease and submission**

   - `excon_list_tasks` 恢复已发放 Task；使用 Task 自身 `lockVersion` 调用 `excon_claim_task`。
   - 保存返回的 `claimEpoch` 与不透明 `leaseToken`，然后 begin，长任务在到期前 heartbeat。
   - `excon_submit_task_result` 必须引用至少一个已验证 Receipt 或已授权 ArtifactVersion。
   - Recover issued Tasks, claim with the Task's own `lockVersion`, preserve `claimEpoch` and the opaque `leaseToken`, then begin and heartbeat before expiry. A result must cite at least one verified Receipt or authorized ArtifactVersion.

3. **多智能体协作与回放 / Multi-agent collaboration and replay**

   - 使用 `excon_post_message` 传递明确请求，使用 `excon_publish_artifact`/`excon_publish_artifact_version` 共享不可变证据。
   - 先通过 `excon_sync` 获取 Submission Receipt，再用 `excon_list_submissions` 恢复并审阅精确不可变修订；仅在 Feedback 发放匹配 ActionGrant 后调用 `excon_endorse_submission`。
   - 交接时用 `excon_get_replay_cursor` 请求自身 `agent` 视角；工具不允许 operator/team/role/eligible 视角。
   - Use explicit Messages and immutable ArtifactVersions to collaborate. Before endorsement, issue the Submission Receipt with `excon_sync`, recover and review the exact immutable revision with `excon_list_submissions`, and require matching Feedback to grant the action. Handoff with the agent-safe replay tool, which never exposes operator/team/role/eligible perspectives.

## 安全与响应边界 / Safety and response bounds

- 所有输入使用 strict Zod schema；额外字段（包括 token）在发送 HTTP 前被拒绝。 / All inputs use strict Zod schemas; extra fields, including tokens, are rejected before HTTP dispatch.
- 所有写工具都要求 UUID 幂等键。安全重试时 actor、tool/path、body 与幂等键必须完全不变。 / Every write requires a UUID idempotency key; a safe retry preserves the actor, tool/path, body, and key exactly.
- 成功工具在中文优先的 `content` 中镜像紧凑 `MACHINE_DATA`，同时保留同一份机器可读 `structuredContent`，兼容只展示文本的 Agent 客户端；API `details` 不会转发。 / Successful tools mirror compact `MACHINE_DATA` in Chinese-first `content` while preserving the same machine-readable `structuredContent` for text-only Agent clients; API `details` are never forwarded.
- 单次完整 MCP 响应超过 32,000 字符时，适配器返回 `MCP_RESPONSE_TOO_LARGE`，并要求缩小 `sync.maxItems` 或回放游标。 / A complete MCP response over 32,000 characters returns `MCP_RESPONSE_TOO_LARGE` with guidance to narrow `sync.maxItems` or the replay cursor.

Resource `excon://scenarios/jing-jin-ji-yongding-river` 提供中英文的京津冀永定河合成多智能体演练说明。 / The resource provides the bilingual guide for the synthetic Jing-Jin-Ji Yongding River multi-agent exercise.

## 当前后端边界 / Current backend boundary

这 18 个 v2 Tools 已实现并由 MCP `listTools()` 与 HTTP request-mapping 测试验证，但 MCP 只是适配器。当前 Fastify v2 服务使用不持久化的内存协议实现；Supabase v2 schema/RLS 尚未通过 PostgreSQL API adapter 接入。交互式运行还需要受信运行时提供绑定到具体 RunAgent 的 credential。

These 18 v2 Tools are implemented and verified by MCP `listTools()` and HTTP request-mapping tests, but MCP remains only an adapter. The current Fastify v2 service uses a non-durable in-memory protocol implementation; the Supabase v2 schema/RLS is not yet connected through a PostgreSQL API adapter. An interactive Run also requires a trusted runtime to provision a credential bound to the concrete RunAgent.

本机 v2 Lab 已交付确定性 evaluator → rework → resubmit 与团队背书闭环，但仍是非持久化开发 profile。参训者安全的 `GET runs/{runId}/submissions` 与 `excon_list_submissions` 只恢复自身已 Receipt 的不可变快照；不得用 operator replay 替代。

The local v2 Lab delivers the deterministic evaluator → rework → resubmit and team-endorsement loop, but it remains a non-durable development profile. Participant-safe `GET runs/{runId}/submissions` and `excon_list_submissions` recover only immutable snapshots already receipted to the caller; never substitute operator replay.
