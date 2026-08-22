---
title: Agent EXCON 架构
description: Agent EXCON 的多智能体领域、持久化、并发、可见性、回放与可观测性边界。
docType: architecture
scope: agent-excon
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 理解或修改 Agent EXCON 领域、协议、持久化、Worker、Web 或回放时
whenToUpdate:
  - EXCON 核心不变量、运行时组合、兼容边界或权威事实变化时
checkPaths:
  - packages/contracts/**
  - packages/core/**
  - packages/infra/**
  - packages/excon-scenarios/**
  - apps/api/src/v2-*
  - apps/worker/**
  - apps/mcp/src/**
  - apps/web/src/app/*/scenarios/**
  - apps/web/src/app/*/runs/**
  - supabase/**
  - infrastructure/observability/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

Agent EXCON（智能体演练场 / 导调中枢）把水系统任务编译成可版本化、可并行、可裁决、可回放的多智能体环境。它与 Data Foundation 共用 WISER 的 Auth、API、Web、MCP 和文档宿主，但不共享领域状态机或权威事实。

外部智能体加载版本化 Skill 后通过 HTTP 或 MCP 参训。Web 负责场景与 Run 的管理、观察、诊断和回放，不替智能体领取任务、提交结果或推进演练。

## 系统组成

| 层                      | 位置                         | 职责                                                            |
| ----------------------- | ---------------------------- | --------------------------------------------------------------- |
| Contracts               | `packages/contracts`         | strict DTO、协议 schema 与公开错误                              |
| Core                    | `packages/core`              | Run、Task、Barrier、Event/Receipt、评价与归因的纯确定性规则     |
| Application/infra       | `packages/infra`、`apps/api` | 用例组合、AI adapter、HTTP、Auth 与持久化边界                   |
| Scenario assets         | `packages/excon-scenarios`   | 经过校验的版本化运行时场景包                                    |
| v1 compatibility worker | `apps/worker`                | 消费 PostgreSQL v1 Episode evaluation jobs；默认 API 不 enqueue |
| MCP                     | `apps/mcp`                   | 把参训 Tool 映射到 HTTP API；不读取数据库                       |
| Web                     | `apps/web`                   | 场景、Run、协作、回放、Trace 与诊断界面                         |
| Database                | `supabase`                   | EXCON schema、RLS、journal、seed 与 pgTAP                       |

Core 不导入数据库、HTTP、框架、时钟、随机、文件系统或 AI provider。依赖方向始终从纯领域向外。

## 领域层级

```text
Scenario（目录身份）
└── ScenarioVersion（发布后不可变的蓝图）
    └── ExerciseRun（一次团队演练）
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / ArtifactVersion
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

新场景必须定义多个必需角色、至少两个不同 RunAgent 和明确的汇流 Task/Barrier。给同一个 Agent 添加多个角色标签不能满足人员 quorum。

## 运行时与持久化

```text
Supabase JWT / wdc1 delegated credential
              │ WISER Platform Resolver
              ▼
外部 Agent + Skill ── HTTP/MCP ──► Fastify /api/v2
                                      │
                                      ├─ deterministic service projection
                                      │            ▲ startup replay
                                      └─ append-only command journal
                                                   │ Supabase PostgreSQL + RLS
                    safe read DTO ────────────────► Next.js Web
                    authenticated OTLP ───────────► Collector / OTel backends
```

`EXCON_V2_MODE=memory` 只用于显式本机 Lab 和测试。完整栈与生产模式使用非超级用户 PostgreSQL append-only command journal，并在提供 readiness 之前确定性重放全部命令。

每条 mutation 先追加 immutable intent，保存 command、canonical request hash、最小 principal projection、参数与生成/lease key 标识；完成后追加 immutable outcome，保存成功或稳定拒绝、result hash，以及重放所需的 UUID、时间和 lease counter tape。Task lease 明文只存在于响应与调用方状态，journal 只保留带历史 key id 的 HMAC secret reference。

启动流程必须：

1. 拒绝超级用户运行角色；
2. 获取唯一 advisory writer lock；
3. 按 sequence 校验 intent/outcome、hash、稳定错误与 key reference；
4. 将生成值 tape 注入纯 service 并逐条重放；
5. 比较每个结果 hash；
6. 全部一致后才变为 ready。

journal 损坏、outcome 缺失、重放漂移、历史 HMAC key 缺失、第二 writer 或数据库不可用都失败关闭。该实现提供跨重启恢复，不等于多个 API writer 共享的规范化 aggregate repository。

## 并发、租约与幂等

Run 只管理生命周期、阶段和虚拟时钟；等待、租约、提交、评价与重做属于各自 RunTask，一个 Agent 不能冻结整场 Run。

- Task claim 使用乐观版本和 fenced lease；旧 `claimEpoch` 或 lease token 不能 heartbeat、release 或 submit。
- Barrier 只读取已提交的确定性事实，并在并发完成时最多释放一次。
- 所有 mutation 要求 UUID `Idempotency-Key`。同 actor、operation、request hash 与 key 返回原结果；同 key 不同内容稳定冲突。
- ArtifactVersion 从精确 `baseVersionId` 追加，不能静默覆盖并发版本。
- 状态、RunEvent、Receipt、Outbox 与审计结果在其权威事务边界内原子提交；失败事务不留下半状态。

## 显式协作

```text
水情证据 ───┐
水动力约束 ─┼─ parallel Tasks ─→ Barrier ─→ 协调提交
生态目标 ───┘          │                    │
                       └─ Message / ArtifactVersion ─┘
                                                 ▼
                                  个人 / 角色 / 团队 Feedback
```

协作只通过固定收件人快照的 Message、不可变 ArtifactVersion、Submission、endorsement 与 issued Receipt 发生。一个 RunAgent 不继承另一个 RunAgent 的私有上下文；团队关系也不会自动扩大过去或未来的可见性。

## `/sync`、Receipt 与历史视角

`/sync` 是把 eligible 资源实际发放给一个 RunAgent 的唯一入口，并为批次生成 immutable `AgentViewReceipt`。客户端处理后追加独立 acknowledgement；它不能修改 Receipt。

- `eligible`：当时可以获取，但尚未形成发放事实；
- `issued`：服务端固化并尝试返回；
- `acknowledged`：客户端后来确认精确 Receipt chain head。

Recovery GET 只返回已经 issued 的 Task、Message、Artifact、Submission 与 Feedback，不能把 eligible 内容变成 issued。Replay 以 `run_seq` 为切点：operator 按授权读取 operator/team/role/agent projection；RunAgent 只能读取自身 issued/acknowledged 视角。今天的 RLS 或团队成员关系不能反推过去可见性。

## 两个事实层

| 层                                            | 负责                                                                       | 不负责                                            |
| --------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------- |
| RunEvent、AgentViewReceipt 与 command journal | 协议恢复、回放、幂等结果、确定性评价和业务审计事实                         | 技术 waterfall 与 RED 指标                        |
| OpenTelemetry                                 | HTTP/MCP 时延与错误，以及经认证的 participant-reported model/Tool/log 关联 | 业务状态、授权、Barrier、评分、Receipt 或 journal |

一个 Run 不使用持续数小时的单 Trace。Agent turn、异步 Task、Submission 和 Evaluation 使用短 Trace；跨 Agent 与 fan-in 因果通过 Span Links 表达。Telemetry 可以缺失、采样或过期，删除全部 Telemetry 后仍必须能从领域事实完成回放。

## Web 与身份边界

`reference` 模式读取提交在仓库中的设计/回归 fixture，明确标记为预览。`live` 模式只在 Next.js server module 使用 `WISER_WEB_OPERATOR_TOKEN` 读取安全 DTO，并设置 `cache: no-store`；credential 无效、API 不可用或契约不匹配时显示显式 gap，不回退 fixture。

完整栈自动登录的 Supabase operator 当前用于 Data Web/Data smoke，不会自动生成 EXCON Web operator credential 或绑定 RunAgent 的 EXCON MCP credential。配置这些客户端时必须使用最小 scope、短期、可撤销的真实身份。

## v1 兼容边界

`/api/v1` Episode 是显式、独立、内存中的兼容协议。它不写入 v2 journal，状态不会跨重启恢复；v2 错误也不会自动降级到 v1。`apps/worker` 消费的是另一条 PostgreSQL-backed v1 compatibility/testing job 路径，默认 API 的内存 v1 不会向它 enqueue。只有调用方明确选择 v1 协议与 `/api/v1/` 基路径时，Skill/MCP 才注册 legacy 操作。不要把 v1 Episode、该 Worker 与 v2 Run 说成同一执行模型。

## AI 边界

- 测试、CI 与可重复 smoke 使用 fake provider。
- 可信宿主可以显式使用本机 Codex；认证文件不进入容器。
- OpenAI-compatible adapter 的 endpoint、model 与能力由服务端配置。
- AI 可以生成受 schema 约束的解释或建议，不能决定确定性评分、Barrier、授权或最终 verdict。

`apps/worker` 不调用 AI；它只服务 PostgreSQL-backed v1 compatibility/testing 路径。v2 evaluator 运行在 API deterministic service 内，并随 journal 重放。可选 AI adapter 位于可信宿主的 infrastructure/application 边界，输出必须先通过 schema 与本地规则，不能进入任何权威 verdict 路径。

公开操作见 [Agent EXCON HTTP](/protocols/http/) 与 [Agent EXCON MCP](/protocols/mcp/)；测试策略见[测试与验证](/development/testing/)。
