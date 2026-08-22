---
title: HTTP API
description: Agent EXCON v2 已实现路由、身份、Receipt、幂等、回放与当前持久化边界。
docType: protocol-reference
scope: http-api
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 实现或调用 Agent EXCON HTTP API 时
whenToUpdate:
  - 路由、DTO、身份、幂等或持久化边界变化时
checkPaths:
  - apps/api/**
  - packages/contracts/**
  - skills/agent-excon/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 76f3f6d4967c0f7fc13b06ca1480244121a90272
---

## 默认协议与实现状态

HTTP 是唯一业务协议底座。Web、Skill、MCP 和未来 SDK 都调用 HTTP，不直接读取领域表。默认开发基础路径是 `/api/v2`；`/api/v1` 仅供显式 Episode compatibility，不会在 v2 失败时自动回退。

`/api/v2` 有两种明确 runtime。非生产协议测试可显式使用 `EXCON_V2_MODE=memory`；完整栈和生产使用 `postgres`：19 个 mutation 的 intent/outcome 以非超级用户写入 Supabase PostgreSQL append-only journal，启动时用 UUID/时间/lease 生成值 tape 与结果哈希做确定性重放。journal 只允许一个 advisory-lock writer，损坏、重放漂移、未知 HMAC key 或不完整 outcome 都失败关闭。它提供跨重启持久性，但不是把每个 v2 聚合直接映射到规范化 repository。以下表只列实际注册路由。

## WISER 模块组合

Fastify 是 WISER 的共享 HTTP 组合宿主。每个系统以静态导入的 `WiserApiModule` 注册路由；模块 ID 必须使用命名空间且全局唯一，重复 ID 会使 readiness 失败。静态注册不扫描 TypeScript AST，也不允许模块绕过 application/authorization 边界。现有 Agent EXCON 路由保持兼容，Data Foundation 和未来系统复用同一宿主。

`WISER_AUTH_MODE=supabase` 时，默认 API 进程会创建 Supabase `getClaims` client、PostgreSQL Membership loader 并注册平台身份模块。`GET /api/platform/v1/me` 要求 Bearer、Tenant、Project 与 Purpose，只返回安全的 Actor、Role、Scope、最高安全等级与授权版本。生产默认使用该模式且缺少 URL、publishable key 或数据库连接时拒绝启动；非生产 `off` 模式保留旧本机兼容入口。

可注入的 `platform.delegation` 模块定义以下控制面路由：

| 方法 | 路径                                                            | 结果                    |
| ---- | --------------------------------------------------------------- | ----------------------- |
| POST | `/api/platform/v1/delegations`                                  | 创建有边界的 Delegation |
| GET  | `/api/platform/v1/delegations/:delegationId`                    | 读取安全 metadata       |
| POST | `/api/platform/v1/delegations/:delegationId/credentials`        | 一次性返回新明文        |
| POST | `/api/platform/v1/delegations/:delegationId/credentials:rotate` | 轮换并一次性返回新明文  |
| POST | `/api/platform/v1/delegations/:delegationId:revoke`             | 撤销 Delegation         |
| POST | `/api/platform/v1/credentials/:credentialId:revoke`             | 撤销单个 Credential     |

命令要求 UUID `Idempotency-Key`；所有路由都要求 Bearer、Tenant、Project、Purpose Header，以及具备 `platform.delegation.manage` 的 Supabase human。Supabase runtime 模式会注册具体事务 command service 与 delegated Resolver；服务冲突使用稳定且 no-store 的 4xx 错误。

## Data Foundation 发现接口

`GET /api/data/v1/health` 是不可缓存的 data-postgres、对象存储与 Data Worker readiness 聚合；任一权威依赖不可用返回 503。`GET /api/data/v1/capabilities` 返回有序 22 项 Registry、draft-7 输入/输出 JSON Schema 与精确 REST/GraphQL/MCP/Skill mapping。默认 Data runtime 已组合全部 22 个 read/command/specialized-query executor，并注册 REST 与 schema-first GraphQL；启动时 executor 缺失、重复或多余都会失败。共享 `/openapi.json` 标题为 **WISER Platform API**，22 个 Data REST operation 直接从同一 Zod 4 Registry 投影 path/query/body/Header、响应与 bearer security，不维护第二份协议 Schema。

REST 解析统一 WISER principal，无碰撞组合 path/query/body，强制 command UUID 幂等键与版本化 command 的强 `If-Match: "vN"`，输出 ETag/no-store，并把 Operation event page 映射为有界 SSE snapshot。`GET /api/data/v1/evidence/fragments/:evidenceId` 与 `GET /api/data/v1/stac/collections/:collectionId/items/:itemId` 分别要求 `data.knowledge.read`/`data.geo.read`，经 RLS、权威复核、256 KiB 上限和 hash-only audit 支撑 MCP Resource；STAC source href 只能指向受控版本资产路由，后者重新授权后返回短期 `303` signed redirect。完整 Data 协议见 [Data REST](/protocols/data-rest/) 与 [Data GraphQL](/protocols/data-graphql/)。

## 公共场景目录

这些读取不需要 bearer credential，只返回已发布的安全 DTO，不能推断草稿或校验错误。

| 方法  | 路径                                            | 作用                   |
| ----- | ----------------------------------------------- | ---------------------- |
| `GET` | `/api/v2/scenarios`                             | 列出已发布场景         |
| `GET` | `/api/v2/scenarios/{scenarioId}`                | 读取场景及当前发布版本 |
| `GET` | `/api/v2/scenarios/{scenarioId}/versions`       | 列出不可变发布版本     |
| `GET` | `/api/v2/scenario-versions/{scenarioVersionId}` | 读取一个发布版本       |

## Operator 管理与观察

这些路由要求独立的 operator bearer token。operator token 不能携带 `X-Run-Agent-Id` 冒充参训者。

| 方法           | 路径                                                    | 作用                                          |
| -------------- | ------------------------------------------------------- | --------------------------------------------- |
| `GET` / `POST` | `/api/v2/manage/scenarios`                              | 列出自有草稿/发布场景；创建场景目录身份       |
| `POST`         | `/api/v2/manage/scenarios/{scenarioId}/versions`        | 创建可编辑版本草稿                            |
| `POST`         | `/api/v2/manage/scenario-versions/{versionId}:validate` | 校验草稿                                      |
| `POST`         | `/api/v2/manage/scenario-versions/{versionId}:publish`  | 发布不可变版本                                |
| `GET` / `POST` | `/api/v2/agents`                                        | 列出或注册 AgentIdentity                      |
| `POST`         | `/api/v2/agents/{agentId}/versions`                     | 发布不可变 AgentVersion                       |
| `GET`          | `/api/v2/agent-versions/{agentVersionId}`               | 读取 AgentVersion                             |
| `GET` / `POST` | `/api/v2/runs`                                          | 列出或创建 ExerciseRun                        |
| `GET`          | `/api/v2/runs/{runId}`                                  | 读取 Run                                      |
| `GET` / `POST` | `/api/v2/runs/{runId}/agents`                           | 列出或加入独立 RunAgent                       |
| `POST`         | `/api/v2/runs/{runId}:start`                            | 在必需角色由不同 RunAgent 满足后启动          |
| `GET`          | `/api/v2/runs/{runId}/events`                           | 按 `after`/`limit` 读取权威 append-only Event |
| `GET`          | `/api/v2/runs/{runId}/replay`                           | 读取 operator/team/role/agent 的 as-of 投影   |
| `GET`          | `/api/v2/runs/{runId}/traces`                           | 读取最佳努力的 Trace summary overlay          |

场景、AgentVersion 和 Run 管理写入都要求 UUID `Idempotency-Key`，并使用最小聚合的 `expectedVersion`。当前场景验证要求多个必需角色、至少两个不同 RunAgent 和明确的团队汇流条件；同一个 Agent 的多个标签不能满足 quorum。

## RunAgent 参训协议

RunAgent bearer token 必须由服务端绑定到具体 RunAgent。每个请求都携带：

```http
Authorization: Bearer <short-lived-run-agent-token>
X-Run-Agent-Id: <bound-run-agent-uuid>
Accept: application/json
```

每个 `POST` 还携带 `Content-Type: application/json` 与 UUID `Idempotency-Key`。operator token、另一个 RunAgent token 或仅修改 header 都不能取得该身份。

| 方法   | 路径                                              | 作用                                                           |
| ------ | ------------------------------------------------- | -------------------------------------------------------------- |
| `GET`  | `/api/v2/runs/{runId}/me`                         | 核对 credential 绑定的 RunAgent、角色卡和 sync cursor          |
| `POST` | `/api/v2/runs/{runId}/sync`                       | 发放新资源，并可确认上一 Receipt chain head                    |
| `GET`  | `/api/v2/runs/{runId}/tasks`                      | 恢复已经 issued 的 Task                                        |
| `GET`  | `/api/v2/runs/{runId}/messages`                   | 恢复已经 issued 的 Message                                     |
| `GET`  | `/api/v2/runs/{runId}/interactions`               | operator 读取脱敏线程、工件引用与逐收件人交付状态              |
| `GET`  | `/api/v2/runs/{runId}/artifacts`                  | 恢复已经 issued 的 Artifact grant                              |
| `GET`  | `/api/v2/runs/{runId}/submissions`                | 恢复已经 issued 的精确不可变 Submission 修订                   |
| `GET`  | `/api/v2/runs/{runId}/feedback`                   | 恢复已经 issued 的分层 Feedback/ActionGrant                    |
| `POST` | `/api/v2/tasks/{taskId}:claim`                    | 以 Task `lockVersion` 领取有界 fenced lease                    |
| `POST` | `/api/v2/tasks/{taskId}:begin`                    | 以 `claimEpoch` 和不透明 `leaseToken` 开始 Task                |
| `POST` | `/api/v2/tasks/{taskId}:heartbeat`                | 在最大到期时间内请求有限续期                                   |
| `POST` | `/api/v2/tasks/{taskId}:release`                  | 释放当前 lease；旧 token 随即失效                              |
| `POST` | `/api/v2/tasks/{taskId}/submissions`              | 在有效 lease 下创建带 Receipt/ArtifactVersion 证据的不可变结果 |
| `POST` | `/api/v2/runs/{runId}/messages`                   | 向不可变收件人快照发送 Message                                 |
| `POST` | `/api/v2/runs/{runId}/artifacts`                  | 发布 Artifact 与不可变首版                                     |
| `POST` | `/api/v2/artifacts/{artifactId}/versions`         | 从精确 `baseVersionId` 追加版本                                |
| `POST` | `/api/v2/submissions/{submissionId}/endorsements` | 消费匹配 ActionGrant 背书精确修订                              |
| `GET`  | `/api/v2/runs/{runId}/replay`                     | 只读取自身 `issued` 或 `acknowledged` agent 视角               |

## `/sync` 与知识边界

`/sync` 是让新 Task、Message、Artifact grant、Submission 或 Feedback 变为 issued 的唯一入口。五个 recovery GET 只读取已有 Receipt 的资源，不会把 eligible 内容提前变成 issued。Submission recovery 只返回已经向当前 RunAgent 发放 Receipt 的精确不可变修订；背书前必须恢复并审阅该修订，不能用 operator replay 或仅凭 ID 替代。

首次请求：

```json
{ "afterReceiptSeq": 0, "maxItems": 50 }
```

处理完整批次后，下一次请求确认精确链头：

```json
{
  "afterReceiptSeq": 17,
  "ack": {
    "throughReceiptSeq": 17,
    "headHash": "sha256:<64-lowercase-hex>"
  },
  "maxItems": 50
}
```

非空批次的序号必须连续、`previousReceiptHash` 必须连接可信链头、最后一个 `receiptHash` 必须等于响应 `receiptHeadHash`。空批次显式返回 `fromReceiptSeq: null`，保持 `throughReceiptSeq` 和链头不变。Receipt 是不可变 issuance；acknowledgement 是另一个 append-only 事实。

## Task、证据与协作

- claim 只返回一次当前不透明 `leaseToken`；begin/heartbeat/release/submit 都核对 Task version、`claimEpoch` 和 token。不得把 token 写进 Message、Artifact、Submission、日志或遥测。
- Submission 至少引用一个属于当前 RunAgent 的已验证 Receipt，或一个已经向它发放授权的不可变 ArtifactVersion。
- Message 和 Artifact 固定发布时收件人快照；后来加入团队不会自动继承历史。
- Message 使用 `inform`、`request`、`response`、`handoff` 四种语义。`response` 必须通过 `replyToMessageId` 引用调用者已由自身 Receipt 链获得的 `request`，并继承其 `threadId`；未收到父请求的智能体不能回复。
- `handoff` 必须固定至少一个精确 `artifactId`、`artifactVersionId` 与 `contentHash`。Receipt issuance/acknowledgement 只证明交付链状态，不能表述为“已读”“已理解”或“已同意”。
- Artifact 更新以精确 `baseVersionId` 检测冲突，不覆盖并发版本。
- 背书必须消费匹配 actor、Task、Submission 修订、action、scope、期限和次数的 ActionGrant。

不可变提交、背书、ActionGrant 与完整 evaluator → `EVALUATING` → `REWORK`/`ACCEPTED` → revision/resubmit 编排均经过同一 v2 service。完整栈的每条 mutation 先写 journal intent，再写可验证 outcome；重启后按顺序重放并恢复 Event、Receipt 与幂等结果。lease token 只以带 key-id 的 HMAC secret reference 固化，明文不进入 journal。

## 权威回放与 Telemetry overlay

operator 可以按授权请求 operator、team、role 或 agent 投影。RunAgent 只能请求自身 `perspective=agent`，`subjectId` 必须是自身，并只能使用 `deliverySemantics=issued|acknowledged`；它不能请求 `eligible` 或另一个主体。

响应把 `authoritativeProjection` 与 `bestEffortTelemetryOverlay` 分开。Event/Receipt 决定历史知识和审计；Trace summary 可以缺失、迟到或被删除，永远不能改变权限、Barrier、分数或 replay manifest。

## 幂等、错误与安全重试

同一稳定 actor、操作、UUID key 和相同请求返回原结果；同 key 不同请求返回 `409 IDEMPOTENCY_CONFLICT`。模糊失败只能以完全相同的方法、路径、actor、body 和 key 重试，然后使用最小安全读接口对账。

错误 envelope：

```json
{
  "error": {
    "code": "TASK_LEASE_STALE",
    "message": "当前 Task lease 已失效。",
    "traceId": "<request-id>"
  }
}
```

| 状态码 | 含义                                                      |
| ------ | --------------------------------------------------------- |
| `401`  | bearer credential 缺失或无效                              |
| `403`  | 身份、RunAgent 绑定、scope 或已知资源操作不允许           |
| `404`  | 资源不存在或调用方无权知道其存在                          |
| `409`  | 状态、版本、lease、base version、Receipt chain 或幂等冲突 |
| `422`  | schema、字段范围、证据或领域规则失败                      |
| `429`  | 限流；遵循 `Retry-After`                                  |

错误 `details` 只能包含调用方有权知道的信息。切勿把 operator token、service-role key 或数据库凭据交给参训者。

## 显式 v1 compatibility

旧 Episode 路由仍位于 `/api/v1`，包括 create/get/observe/observations/submissions/evaluation/feedback/advance/events。只有任务或协商元数据明确指定 v1 时才使用它；不得混用 v1 Episode ID、version、Observation evidence 或 idempotency key 与 v2 Run。当前 v1 仍是独立服务，尚未翻译到 v2 PostgreSQL 事实。
