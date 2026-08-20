---
title: 总体架构
description: WISER、Agent EXCON、多场景、多智能体、权威回放与 OpenTelemetry 的职责边界。
---

## 产品上下文

**WISER — wiser water, better future**<br />
水地图：AI 赋能的水智能系统与重构引擎<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON（智能体演练场 / 导调中枢）是 WISER 的首个子系统。它把水系统任务编译成可版本化、可并行、可裁决、可回放的多智能体环境。

智能体通过版本化 Skill 调用 HTTP/MCP 参训；Web 负责场景管理、态势展示、Trace 与回放，不代替智能体完成演练。

## v2 分层

```text
Scenario（目录身份）
└── ScenarioVersion（不可变蓝图）
    └── ExerciseRun（一次团队演练）
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / Artifact
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

每个新发布的 v2 场景必须有多个必需角色、至少两个不同 RunAgent 实例和明确的团队汇流任务；一个智能体的多重角色不能满足必需角色 quorum。旧单 Agent Episode 只作为 v1 兼容切片保留。

## 系统边界

```text
多个外部智能体 + Agent EXCON Skill ── HTTP / MCP ──► Protocol API
                                                        │
Next.js 场景中心、导调与回放 ◄──── 安全读模型 ──────────┤
                                                        ▼
                                  导调领域服务 / Task / Barrier
                                       │               │
                                       ▼               ▼
                                PostgreSQL         Worker / Evaluator
                                Auth / RLS              │
                                Event / Receipt         │ OTLP
                                       │                ▼
                                       └──────► OTel Collector
                                                  ├─ Tempo
                                                  ├─ Prometheus
                                                  └─ Loki（可选）
```

## 两个事实层

| 层                            | 负责                                                                                     | 不负责                         |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------ |
| PostgreSQL 领域事件与 Receipt | 完整回放、状态恢复、保存评分输入/结果、审计、权限和“当时视角”                            | 技术 waterfall 和服务 RED 指标 |
| OpenTelemetry 投影            | 服务端边界时延/错误，以及经认证参训者自报的模型/工具调用、token、日志关联和跨 Trace 因果 | 业务状态、授权和完整审计       |

OTel Trace 允许采样和过期，因此永远不能成为演练唯一事实源。一个 Run 也不等于一条超长 Trace；每个 Agent turn、异步 Task、提交或评价形成短 Trace，跨智能体汇聚通过 Span Links 表达。平台始终观测 HTTP/MCP 边界；外部 Agent 内部 Span 只有通过绑定 RunAgent 身份的 Telemetry Ingress 导出后才存在，并标为参训者自报。

## 多智能体协作

Run 只管理生命周期、阶段和虚拟时钟。等待、提交、评价和重做下沉到各自 Task，避免一个智能体冻结整场。

```text
水情与证据 ─┐
水动力约束 ─┼─ 并行 Task ─→ Barrier ─→ 调度协调 ─→ 团队提交
生态目标 ───┘                              │
                                          ▼
                           个人 / 角色 / 团队评价与反馈
```

智能体不能读取其他智能体的内部上下文。协作只能通过具有固定收件人快照的 Message、ArtifactVersion 和 Submission 显式发生。

## 当时视角回放

不能用今天的 RLS 或团队成员关系推算过去的可见性。每次 HTTP/MCP 向某 Agent 准备返回内容时，平台固化不可变 `AgentViewReceipt`；客户端确认另写 append-only acknowledgement，不能回写 Receipt。回放严格区分：

- `acknowledged`：客户端确认收到；
- `issued`：服务端固化并尝试返回；
- `eligible`：由当时的 disclosure grant 计算、但没有生成 Receipt 的可获取内容。

Receipt 的发放和 acknowledgement 分别记录 `issued_run_seq` 与 `acknowledged_run_seq`。Replay cursor 以 `run_seq` 为权威切点，同时展示虚拟时间和 wall clock；它重建水系统、Task、Agent、issued Inject payload/Receipt、工件、提交、评价和已送达反馈，而不是只在浏览器隐藏未来事件。

## 进程职责

| 组件                | 负责                                                  | 不负责                                   |
| ------------------- | ----------------------------------------------------- | ---------------------------------------- |
| Next.js Web         | 场景目录/版本、Run 导调观察、多 Agent Trace、视角回放 | 模拟 Agent 提交；绕过管理员 API 修改事实 |
| Fastify API         | `/api/v1` 兼容、`/api/v2`、认证、幂等、事务和安全 DTO | 页面渲染、智能体内部策略                 |
| Domain Core         | Run/Task/Barrier 状态机、可见性和确定性规则           | 供应商私有模型行为                       |
| Worker              | 评价任务、重试、结果接入                              | 绕过状态机修改数据                       |
| Supabase/PostgreSQL | 事实、锁、RLS、Auth、Storage、Event/Receipt           | 生成自然语言裁决                         |
| MCP Server          | 把稳定 HTTP 操作映射为 Tools/Resources                | 复制业务逻辑或直连数据库                 |
| OTel/Grafana        | 技术可观测、诊断、深链                                | 审计事实、权限或最终 verdict             |

## AI 与 Compose

- **Codex local**：开发和调试默认值，使用宿主机订阅登录。
- **OpenAI-compatible**：部署/provider 模式，固定 endpoint、模型和能力集。
- **Fake**：单元、集成和 CI 的确定性默认值。

Supabase CLI 管理本地 Auth、PostgreSQL、Storage、PostgREST 与 Studio；仓库 Compose 管理 API、Web、Worker 和文档。v2 增加可选 `observability` profile：OTel Collector、Tempo、Prometheus、Grafana，Loki 后置可选。

完整模型、API、表结构、TDD 和迁移顺序见仓库中的 `docs/design/v2-multi-scenario-multi-agent-observability.md`。
