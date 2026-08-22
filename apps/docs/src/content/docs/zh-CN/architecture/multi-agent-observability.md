---
title: 多智能体导调与可观测性
description: 场景管理、多 Agent Run、OTel 式 Trace 和当时视角回放的 v2 设计。
docType: architecture
scope: observability
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 修改导调台、回放或技术观测链路时
whenToUpdate:
  - 权威事实、Telemetry 信任或展示行为变化时
checkPaths:
  - apps/web/**
  - apps/telemetry-ingress/**
  - infrastructure/observability/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 574446ae6c540c2e1d365473f6b0d81469ec9367
---

## 一个 Run 是一次团队演练

v2 把 `Scenario → ScenarioVersion → ExerciseRun → RunAgent` 作为主导航。每个新场景必须定义多个必需角色、并行 Task、汇流 Barrier 和团队提交，并由不同 RunAgent 实例占据必需角色；不能只给一个 Agent 添加多个标签。

Run 只管理阶段和虚拟时钟；评价与重做属于各自 Task。这样水情、水动力、生态目标和调度协调 Agent 可以同时工作。

```text
水情与证据 ─┐
水动力约束 ─┼─ Artifact/Message ─→ 调度协调 ─→ Team Submission
生态目标 ───┘                              │
                                          ▼
                              个人 / 角色 / 团队反馈
```

## 导调台信息架构

全局导航只保留“场景库”和“运行指挥”。场景库负责草稿、校验、发布、版本和团队契约；运行指挥默认只读，每个 Run 再分为“总览 / 协作 / 评测 / Trace / 回放”五个工作区。

- **总览**先回答权威结果、最高风险和下一步，只展示前三项关注、团队态势、最近事件与流域决策脊柱。
- **协作**以汇流账本呈现 request/response、ArtifactVersion handoff 和逐收件人 Receipt 状态；不把 acknowledgement 描述成已读或同意。
- **评测**核对权威 Event、Barrier 与 evaluator verdict，并把 OpenTelemetry 覆盖缺口作为诊断信号，不让遥测替代裁决。
- **Trace**使用 wall clock 瀑布、Agent 泳道和 Span Inspector 定位执行问题；窄屏转换为可扫读的事件流。
- **回放**按 `run_seq` 和当时视角重建收据、事件与可见证据，技术遥测只作为 best-effort 叠加。

```text
场景库 ──→ 场景编排 ──→ 关联 Run
                         │
运行指挥 ──→ Run 总览 ──┼─→ 评测
                         ├─→ 协作
                         ├─→ Trace
                         └─→ 回放
```

Run 总览的视觉签名是“流域决策脊柱”：水情、水力和生态三个专业角色像支流并行，依次穿过分析 Barrier、调度协调与背书 Barrier，最后抵达权威裁决。这里的节点和连接全部来自真实角色、Barrier 与 verdict 数据；协作页只使用 Message、ArtifactVersion 和 Receipt 事实，Trace 中的连接也只表达真实 Span Links。

## OTel 借鉴边界

- Run 是业务关联键，不是一条持续数小时的 Trace。
- 一轮 Agent 执行、异步 Task、团队提交和 Evaluation 分别形成短 Trace。
- parent/child 表示单条调用树；跨 Agent、队列和 fan-in 用 Span Links。
- 平台始终能看到 HTTP/MCP 等 EXCON 边界；模型/Tool 内部 Span 只有在参训者经认证入口主动导出时才存在，并标记为 `participant_reported`。
- Waterfall 横轴表示 wall clock；领域标记表示 `run_seq` 和虚拟时间。
- prompt、Tool 正文、隐藏 Outcome、私有反馈和思维链默认不进入 OTLP。
- Trace 缺失时显示“未观测”，领域回放仍可完整工作。

OTel 投影经适配器映射到稳定的 WISER DTO。GenAI/Agent/Tool/MCP 约定仍可能变化，领域模型和前端不能直接绑定实验属性名。`traceparent` 只能建立关联，不能自动取得外部 Agent 内部 Span；未接入 exporter 时 UI 只能显示边界观测。

## 回放不是播放动画

回放由服务端 as-of projection 重建，而不是在浏览器隐藏未来事件。权威 `authoritativeProjection` 恢复：

- 截止 `run_seq` 的水系统与虚拟时钟；
- Task、Agent、Barrier 和协作工件状态；
- 当前视角通过 `/sync` 实际收到的 Inject payload/Receipt；
- Submission、Evaluation 和已经发放的 Feedback；

Trace/Log 作为单独的 `bestEffortTelemetryOverlay` 按权限叠加，明确显示 source、trust、coverage、迟到和丢弃数；它不进入 Agent-known 集、评分或签名 replay manifest。

单 Agent 视角来自不可变 issuance `AgentViewReceipt` 和 append-only acknowledgement；两者各有自己的 `run_seq`，因此可在任意 cursor 严格判断当时状态。`eligible` 由 disclosure grant 计算而不是一种 Receipt；未拉取的 Inject 不能被描述为该 Agent 已知。

## 推荐观测栈

可选 Compose profile 使用：

```text
Participant exporter → 认证 Telemetry Ingress ┐
WISER services ────────────────────────────────┴→ OTel Collector → Tempo
                                                               → Prometheus
                                                               → Loki
Grafana ← Tempo + Prometheus + Loki
```

参训者不能直连 Collector；Ingress 绑定 RunAgent 身份、覆盖身份属性、限流并拒绝敏感正文。WISER 自己呈现 Run 级协作图和领域回放；Grafana/Tempo 用于单个 Trace 的 technical drill-down。两侧通过 `trace_id` 和 `event_id` 深链。

## 验收案例

同一永定河场景版本启动四角色 Run。四个不同 RunAgent 获得不同 Receipt 并行工作，通过 Artifact 汇聚到团队 Submission；Evaluation 分别返回个人、角色和团队 Feedback；导调员切换 Agent 视角时看不到其当时未获得的信息。删除全部 Telemetry 后，Event/Receipt 回放仍能复算。
