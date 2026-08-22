---
title: Agent EXCON 总体架构
description: Agent EXCON v2 的多智能体领域、持久 command journal、权威回放与 OpenTelemetry 边界。
docType: architecture
scope: agent-excon-v2
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改 EXCON v2 系统边界或理解组件关系时
whenToUpdate:
  - 核心、协议、持久化或观测架构变化时
checkPaths:
  - packages/contracts/**
  - packages/core/**
  - apps/api/src/v2-*/**
  - apps/mcp/**
  - apps/web/**
  - supabase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: fe6687b78bae4241b59c82280f4a97b2fcff05d3
---

## 产品上下文

Agent EXCON（智能体演练场 / 导调中枢）是 WISER 的首个业务系统。它把水系统任务编译成可版本化、可并行、可裁决、可回放的多智能体环境。Data Foundation 是平级系统；两者共享平台 Auth、API/MCP/Web/文档宿主，但不共享领域状态机或权威事实。

外部智能体加载版本化 Skill 后通过 HTTP/MCP 参训。Web 管理和展示场景、Run、Trace 与回放，不代替智能体提交、推进或调用 Tool。

## 当前实现

| 层                  | 已交付                                                                                                      | 明确边界                                                              |
| ------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Contracts/Core      | v2 strict DTO；Run、Task、Barrier、Event/Receipt、Feedback/attribution 纯确定性规则                         | Core 不导入基础设施                                                   |
| Fastify API         | 场景/Agent/Run、`/sync`、Task lease、Message/Artifact、Submission/endorsement、recovery、Event/replay/trace | v2 持久层是 command journal + replay，不是规范化 aggregate repository |
| Supabase/PostgreSQL | v2 schema/RLS；append-only intent/outcome journal；非超级用户 runtime role 与 pgTAP                         | journal 单 writer；v1 状态不持久                                      |
| Skill/MCP           | v2 默认 Skill；18 个 MCP Tool；Receipt-gated Submission recovery；有界 wait-and-sync                        | 只调用 HTTP，不读 journal/数据库                                      |
| Observability       | Telemetry Ingress、Collector、Tempo、Prometheus、Loki、Grafana、身份覆盖/限额/脱敏                          | 参训内部 Span 依赖外部 exporter，永不成为审计事实                     |
| Web                 | 中文默认的多场景 reference/live、分 Agent Trace、评价/Barrier/修订诊断、视角回放                            | live 失败时显示 gap，不回退 fixture 或伪造过程                        |

v1 Episode 只作为显式 compatibility 保留，仍是独立内存实现；v2 失败不会自动降级。

## v2 领域分层

```text
Scenario（目录身份）
└── ScenarioVersion（不可变蓝图）
    └── ExerciseRun（一次团队演练）
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / ArtifactVersion
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

新发布场景必须有多个必需角色、至少两个不同 RunAgent 和明确汇流条件；给一个 Agent 添加多个标签不能满足 quorum。

## 当前运行路径

```text
Supabase JWT / wdc1 delegated credential
              │ unified Platform Resolver
              ▼
外部 Agent + Skill ─ HTTP/MCP ─► Fastify /api/v2
                                  │
                                  ├─ deterministic v2 service projection
                                  │      ▲ startup replay
                                  │      │
                                  └─ append-only command journal
                                         │ Supabase PostgreSQL / RLS
                                         │
               safe DTO ────────────────► Next.js read-only Web
               OTLP ────────────────────► Collector → Tempo/Prometheus/Loki
```

非生产可显式选择 `EXCON_V2_MODE=memory`。完整栈和生产强制 `postgres`，要求非超级用户 DSN 与保留历史 key 的 HMAC key ring。API 固定注入 Tenant/Project/Purpose，并通过同一 Platform Resolver 验证 operator/run_agent 与 RunAgent binding。

## Command journal 的持久语义

journal 覆盖 19 个 mutation：Scenario/Version、Agent/Version、Run/join/start、sync、Task claim/begin/heartbeat/release/submit、Message、Artifact/Version 与 endorsement。

每条命令先追加 immutable intent：command name、canonical request hash、最小 principal projection、参数与 lease key id；执行完成后追加 immutable outcome：成功/稳定拒绝、result hash、生成 UUID/时间 tape 和 lease counter。Task lease 明文只在响应和调用方本地存在；journal 只保存带 key-id 的 HMAC secret reference。

启动时：

1. 验证 DSN 用户不是超级用户；
2. 获取唯一 advisory writer lock；
3. 按 sequence 加载 intent/outcome；
4. 校验结构、hash、错误码、key reference 和生成值上限；
5. 把 tape 注入纯确定性 service 逐条重放；
6. 比较成功结果或稳定拒绝的 hash；
7. 全部通过后才 readiness。

journal 损坏、outcome 缺失、重放漂移、历史 HMAC key 缺失、第二 writer 或数据库不可用均失败关闭。该模式提供跨重启恢复和幂等结果，但不是跨多个 API writer 的共享 mutable aggregate store。

## 两个事实层

| 层                                           | 负责                                                                    | 不负责                                            |
| -------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| 领域 Event/Receipt + durable command journal | 协议状态恢复、Replay、Receipt chain、幂等结果、确定性评价与安全审计线索 | 技术 waterfall 与 RED 指标                        |
| OpenTelemetry 投影                           | HTTP/MCP 边界时延/错误，以及认证参训者自报的模型/Tool、token 与日志关联 | 业务状态、授权、Barrier、评分、Receipt 或 journal |

一个 Run 不使用持续数小时的单 Trace。Agent turn、异步 Task、Submission 与 Evaluation 形成短 Trace；跨智能体和 fan-in 用 Span Links。平台只保证自身 HTTP/MCP 边界观测；外部 Agent 内部 Span 必须主动通过认证 Ingress 导出并标记 `participant_reported`。

## 多智能体执行与协作

Run 只管理生命周期、阶段和虚拟时钟；等待、lease、提交、评价和重做属于各自 Task，避免一个 Agent 冻结全场。

```text
水情证据 ───┐
水动力约束 ─┼─ parallel Task ─→ Barrier ─→ 协调提交
生态目标 ───┘          │                    │
                       └─ Message / ArtifactVersion ─┘
                                                 ▼
                                  个人 / 角色 / 团队 Feedback
```

协作只通过固定收件人快照的 Message、不可变 ArtifactVersion、Submission、endorsement 与 issued Receipt 发生。一个 Agent 不能继承另一个 Agent 的私有上下文。

## `/sync` 与历史视角

今天的 RLS 或团队成员关系不能推算过去可见性。`/sync` 为实际发放给一个 RunAgent 的资源生成 immutable `AgentViewReceipt`；客户端确认另写 append-only acknowledgement，不能修改 Receipt。

- `acknowledged`：客户端后来确认精确链头；
- `issued`：服务端固化并尝试返回；
- `eligible`：当时 disclosure 允许获取但尚无 Receipt。

Replay 以 `run_seq` 为切点。operator 可按授权读取 operator/team/role/agent projection；RunAgent 只能读取自身 issued/acknowledged 视角。重启后 journal replay 恢复相同 Event、Receipt、ack 和 replay projection，hash 不同则服务拒绝 readiness。

## Web reference/live

`reference` 是固定设计/回归 fixture，不是外部智能体真实运行证据。`live` 只在 server module 使用有效 operator credential，以 `cache: no-store` 读取安全 DTO；请求失败或契约不匹配时 fail closed，不回退 reference。缺少外部 Agent exporter 时，页面显示 telemetry gap，不生成虚假 model/tool Span。

## AI 与本地运维

- Codex local 只在可信宿主开发调试使用，本机凭据不进入容器；
- OpenAI-compatible 模式固定 endpoint、model 与能力集；
- Fake 是测试/CI 默认；AI 不决定确定性分数、Barrier 或最终 verdict。

Supabase CLI 管理统一 Auth、控制面、EXCON schema/journal 与 pgTAP；Compose 管理 API、Web、Workers、文档、Data Foundation 和可选 observability。详细不变量见仓库 `docs/design/v2-multi-scenario-multi-agent-observability.md`。
