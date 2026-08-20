---
title: 总体架构
description: WISER Agent EXCON v2 的当前实现、目标边界、多智能体协作、权威回放与 OpenTelemetry。
---

## 产品上下文

**WISER — wiser water, better future**<br />
水地图：AI 赋能的水智能系统与重构引擎<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON（智能体演练场 / 导调中枢）是 WISER 的首个子系统。它把水系统任务编译成可版本化、可并行、可裁决、可回放的多智能体环境。

外部智能体加载版本化 Skill 后通过 HTTP/MCP 参训；Web 管理和展示场景、Run、Trace 与回放，绝不代替智能体提交、推进或调用 Tool。

## 当前实现快照

| 层                  | 已交付                                                                                                                             | 边界 / 尚未交付                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Contracts/Core      | v2 严格 DTO；Run、Task、Barrier、Event/Receipt、Feedback/attribution 的纯确定性状态机                                              | 与基础设施无关，保持纯净                                        |
| Fastify API         | 公共/管理场景、Agent/Run、`/sync`、Task lease、Message/Artifact、Submission/endorsement、安全 recovery、Event/replay/trace summary | 当前是非持久化**内存协议适配器**                                |
| Supabase/PostgreSQL | v2 schema、约束、RLS、私有 Event/Outbox/credential/telemetry 表、seed 与 pgTAP                                                     | PostgreSQL API adapter 尚未接线                                 |
| Skill/MCP           | v2 默认 RunAgent Skill；17 个 stdio MCP Tools，包括 Receipt-gated Submission 安全恢复；显式 v1 compatibility                       | 完整 evaluator → rework → resubmit 未打通                       |
| Observability       | 认证 Telemetry Ingress、Collector、Tempo、Prometheus、Loki、Grafana、身份覆盖、限额、脱敏和 smoke                                  | 参训内部 Span 仍取决于外部 exporter，Telemetry 永不成为审计事实 |
| Web                 | 中文默认的多场景 reference/live 只读模式、分 Agent Trace、信任/覆盖标签和视角回放                                                  | live 显式显示缺失数据，不回退 fixture 或伪造过程                |

v1 Episode 只作为显式兼容协议保留。它目前仍是独立实现，不是已经翻译到 v2 Event/Receipt 的 compatibility facade。

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

新发布的 v2 场景必须定义多个必需角色、至少两个不同 RunAgent 和明确的团队汇流条件。给一个 Agent 添加多个角色标签不能满足 quorum。

## 运行边界：当前与目标

```text
多个外部智能体 + Agent EXCON Skill
                  │ HTTP / MCP
                  ▼
        Fastify /api/v2 协议层
        [当前：内存协议适配器]
             │            │
             │ safe DTO   ├── OTLP 边界观测
             ▼            ▼
  Next.js 只读 Web      OTel Collector ─┬─ Tempo
  reference / live                     ├─ Prometheus
                                       └─ Loki
                                          ▲
外部 Agent exporter → 认证 Telemetry Ingress ┘

Supabase/PostgreSQL v2 schema + RLS + Event/Receipt 已交付
             ▲
             └── [目标：PostgreSQL API adapter 原子接线；当前尚未连接]
```

Compose `observability` profile 是按需启动的本地技术诊断组，但该 profile 启动时始终包含 Collector、Tempo、Prometheus、Loki、Grafana 和 Telemetry Ingress。Loki 不是后置可选组件。

## 两个事实层

| 层                                               | 负责                                                                                         | 不负责                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------- | --------------------------------------- |
| PostgreSQL 领域 Event 与 Receipt（目标权威存储） | 完整回放、状态恢复、评分输入/结果、审计、权限和历史视角                                      | 技术 waterfall 与服务 RED 指标          |
| OpenTelemetry 投影                               | HTTP/MCP 边界时延/错误，以及经认证参训者自报的模型/Tool 调用、token、日志关联和跨 Trace 因果 | 业务状态、授权、Barrier、评分和完整审计 |

当前内存 API 已实现相同的 Event/Receipt 投影语义以支持 TDD，但只有 PostgreSQL adapter 接线后才能满足持久化、事务与故障恢复要求。存在 schema 不等于运行中的 API 已经使用它。

Trace 允许采样和过期，因此一个 Run 不能建成一条持续数小时的 Trace。Agent turn、异步 Task、Submission 和 Evaluation 形成短 Trace；parent/child 表达单调用树，跨智能体与 fan-in 使用 Span Links。平台能观测自身 HTTP/MCP 边界；外部 Agent 内部 Span 只有通过认证 Ingress 主动导出才存在，并标记 `participant_reported`。

## 多智能体执行

Run 管理生命周期、阶段和虚拟时钟。等待、lease、提交、评价和重做属于各自 Task，避免一个智能体冻结整场。

```text
水情与证据 ─┐
水动力约束 ─┼─ 并行 Task ─→ Barrier ─→ 调度协调 ─→ 团队 Submission
生态目标 ───┘          │                   │
                       └─ Message / ArtifactVersion ─┘
                                               ▼
                                个人 / 角色 / 团队 Feedback
```

智能体不能读取其他智能体的内部上下文。协作只通过固定收件人快照的 Message、ArtifactVersion、Submission、endorsement 与已经 issued 的 Receipt 显式发生。

## 当时视角回放

今天的 RLS 或团队成员关系不能推算过去的可见性。`/sync` 为实际发放给某 RunAgent 的资源生成不可变 `AgentViewReceipt`；客户端确认另写 append-only acknowledgement，不能回写 Receipt。

- `acknowledged`：客户端后来确认收到；
- `issued`：服务端固化并尝试返回；
- `eligible`：当时 disclosure grant 允许获取，但没有生成 Receipt。

回放以 `run_seq` 为权威切点，并展示虚拟时间和 wall time。operator 能读取授权的 operator/team/role/agent 投影；RunAgent 只能读取自身 issued/acknowledged 视角。浏览器不能通过先取完整事实再隐藏字段来模拟权限。

当前内存服务已提供 as-of replay。目标 PostgreSQL adapter 必须让状态变化、Event、Receipt、idempotency 与 Outbox 在一个明确事务边界内提交。v1 facade/backfill 也尚未完成。

## Web 的 reference 与 live

`reference` 模式使用固定 fixture 说明协作河网、Agent 泳道、Trace trust/coverage 和视角回放。它是设计参考，不是一次外部智能体实际运行的证据。

`live` 模式只在 server module 使用 operator token，读取公共场景、Run/RunAgent、operator replay 和 trace summary DTO；`cache: no-store`，失败或契约不匹配时 fail closed，不回退 fixture。当前 API 没有 checkpoint、水系 topology、完整 AgentIdentity/model/tool 或 Span 明细时，Web 必须显示 gap，不能伪造。

## 进程职责

| 组件                             | 当前职责                                                            | 禁止事项                                             |
| -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| Next.js Web                      | 场景/reference 与只读 live Run 观察、Trace summary、回放和 gap 呈现 | 模拟参训写入；把 operator 数据降权成 Agent 视角      |
| Fastify API                      | v1 独立兼容路由；v2 内存协议、认证、幂等、状态机和安全 DTO          | 声称已持久化；把 Web 当参训客户端                    |
| Domain Core                      | 纯 Run/Task/Barrier/Receipt/Feedback 确定性规则                     | 导入数据库、HTTP、时钟、随机、文件系统或 AI provider |
| Worker                           | 现有确定性队列/评价基础                                             | 绕过状态机；宣称 v2 完整 evaluator 链已交付          |
| Supabase/PostgreSQL              | 已交付 schema、RLS、约束、私有事实与 credential 边界                | 在 adapter 接线前被描述为运行中 API 存储             |
| MCP Server                       | 把已实现 HTTP 操作映射为严格 Tools/Resource                         | 复制业务逻辑、直连数据库或自动降级到 v1              |
| Telemetry Ingress + OTel/Grafana | 技术观测、身份约束、脱敏、诊断与深链                                | 充当审计、权限、Barrier 或 verdict 来源              |

## AI 与本地运维

- **Codex local**：宿主机可信开发/调试默认值，复用本机订阅登录，凭据不进入容器。
- **OpenAI-compatible**：部署/provider 模式，固定 endpoint、模型和能力集。
- **Fake**：单元、集成和 CI 的确定性默认值。

Supabase CLI 管理本地 Auth、PostgreSQL、Storage、PostgREST 与 Studio；仓库 Compose 管理 API、Web、Worker、文档及 `observability` profile。完整目标模型、迁移与 TDD 矩阵见仓库 `docs/design/v2-multi-scenario-multi-agent-observability.md`。
