# WISER Agent EXCON v2：多场景、多智能体与可观测导调总体设计

> 状态：Accepted for incremental delivery<br />
> 更新：2026-08-20<br />
> 产品上下文：**WISER — wiser water, better future**<br />
> 中文定义：**水地图：AI 赋能的水智能系统与重构引擎**<br />
> 英文定义：**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

## 1. 决策摘要

WISER 是产品与平台总上下文，Agent EXCON（智能体演练场 / 导调中枢）是第一个子系统。v2 不再把一次演练建模为“一个智能体完成一个 Episode”，而采用下列层级：

```text
Scenario（可管理的场景目录项）
└── ScenarioVersion（发布后不可变的演练蓝图）
    └── ExerciseRun（一次团队演练）
        ├── RunAgent + RoleSlot（多个外部智能体与角色）
        ├── RunTask + Barrier（并行任务与汇流关卡）
        ├── Artifact + Message（显式协作）
        ├── Submission + Evaluation + Feedback（分层裁决）
        ├── RunEvent + AgentViewReceipt（权威事实与视角回放）
        └── Trace + Span + Log + Metric（派生可观测投影）
```

三条不可混淆的产品边界：

1. 智能体继续通过版本化 Skill 调用 HTTP/MCP 参训；Web 不模拟智能体完成任务。
2. Web 分为场景管理区和导调观察区；普通观察页面只读，管理命令由明确的管理员权限、幂等键和审计事件保护。
3. PostgreSQL 追加式领域事件是演练事实源；OpenTelemetry 是可丢失、可采样、可过期的技术观测投影，不承担业务审计或授权。

## 2. 目标与非目标

### 2.1 v2 目标

- 管理多个水系统演练场景、草稿和不可变发布版本。
- 每个新发布场景必须定义多个必需角色，并要求至少两个不同的 RunAgent 实例占据这些必需角色；不能让一个外部智能体通过多重角色独立完成。
- 同一 Run 中允许多个智能体并行认领任务、共享显式工件并分别获得反馈。
- 同时评价个人、角色和团队成果，且团队成绩不自动平均给个人。
- 导调台按场景、Run、阶段、角色和智能体查看全过程。
- 支持“导调全景、团队、角色、单智能体”四类历史视角回放。
- 以 OTel 式 waterfall、Span Links、日志关联、RED 指标和协作图定位技术问题。
- 保留现有单智能体 v1 walking slice，通过兼容适配器渐进迁移。

### 2.2 非目标

- 不记录、推断或展示智能体的隐藏思维链。
- 不把 EXCON 变成默认的智能体编排框架；外部编排器或场景中的协调角色负责协作策略。
- 不用 AI 生成确定性分数、Barrier 判定或最终 verdict。
- 不把 Grafana、Tempo、Jaeger 或原始 OTLP payload 当成业务数据库。
- v2 首期不引入 Kubernetes、Redis、Kafka 或第二套消息队列。
- 不用一个跨数小时或数天的超长 Trace 表示整个 Run。

## 3. 设计原则

### 3.1 场景是版本化产品，不是前端 fixture

`Scenario` 是可变的目录身份；`ScenarioVersion` 的编译内容在发布后不可变。一次 Run 永久固定到一个版本。任何规则、角色、Skill、数据、评价器或可见性策略的修改都必须创建新草稿版本。Retire 只追加独立 lifecycle event 并更新目录投影，不修改或删除已发布内容。

### 3.2 Run 只管理全局生命周期

现有 Episode 的 `waiting/evaluating/feedback_available` 会让一个智能体的提交冻结整场。v2 中 Run 只管理阶段、虚拟时钟和整体生命周期；等待、提交、评价、反馈和重做下沉到 Task/Submission。不同 Task 使用独立乐观锁，允许真正并行。

### 3.3 协作必须显式发生

同团队不等于共享内部记忆。智能体之间只通过有收件人快照的 Message、不可变 ArtifactVersion、Submission 和 Feedback 交换信息。场景的可见性策略决定谁在什么时点能获得什么内容。

### 3.4 回放“平台可证明的过程”

“全过程”准确指平台接收、发放、存储或观测到的显式过程：命令、信息发放、消息、工件、提交、裁决、反馈、工具调用摘要和安全日志。HTTP 只能证明内容被固化、尝试发出或由客户端确认，不能证明智能体理解了内容。

### 3.5 双时钟、双事实层

- 业务顺序：`run_seq` + `virtual_time`，由 PostgreSQL 事件流负责。
- 技术时序：wall clock + Span duration，由 OTel 负责。
- 审计事实：完整、不采样、事务一致。
- Telemetry：允许缺失，缺失时 UI 必须显示“未观测”，不能推断智能体空闲。

## 4. 系统上下文

```text
外部 Agent A/B/C/D
  └─ Agent EXCON Skill
       ├─ HTTP /api/v2 ──────────────► Fastify Protocol API
       ├─ MCP（只映射 HTTP）──────────► Fastify Protocol API
       └─ 可选 WISER Telemetry SDK ──► Authenticated Telemetry Ingress
                                               │
             Fastify / Worker / MCP ──OTLP─────┤
                                               ▼
                                      OTel Collector Contrib
                                      ├─ Tempo / traces
                                      ├─ Prometheus / metrics
                                      └─ Loki / logs（可选）

Fastify Protocol API ──► Domain Core / Postgres / Outbox / Worker
                                 │
                                 └─ Event / Receipt / safe read models
                                               │
                                  ┌────────────┴────────────┐
                                  ▼                         ▼
                           WISER Next.js Web             Grafana
                       场景管理、领域回放、协作视图    技术深查与跨信号诊断
```

WISER Web 通过安全的领域读模型和 Observability Gateway 查询数据。它不直接把私有数据库表或无筛选 OTLP 暴露给浏览器。外部 Agent 不能直连 Collector；可选 Telemetry Ingress 先认证、覆盖身份属性、限流和脱敏。Grafana 是技术深查入口，WISER 与 Grafana 通过 `trace_id` 和领域 `event_id` 双向深链。

## 5. 领域模型

### 5.1 场景侧

| 实体                | 作用                                           | 关键规则                                                 |
| ------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| `Scenario`          | 名称、区域、标签、负责人和说明                 | 可修改；不承载已运行的规则                               |
| `ScenarioVersion`   | 编译后的完整演练蓝图                           | 发布后内容不可修改或删除；退役属于独立 lifecycle         |
| `RoleDefinition`    | 角色职责、人数、能力、工具、信息和交付物       | 至少两个必需角色且由不同 RunAgent 占位；首个案例采用四个 |
| `PhaseDefinition`   | 阶段、虚拟时间和终止条件                       | 只能引用已发布蓝图中的对象                               |
| `TaskDefinition`    | 个人/角色/团队任务与输出 Schema                | Task DAG 必须无环                                        |
| `BarrierDefinition` | `all_required`、quorum、role quorum 或人工批准 | 只读取确定性事实，不能执行任意 SQL                       |
| `VisibilityPolicy`  | Inject、消息、工件和反馈的授权范围             | 发布前做未来信息泄漏测试                                 |
| `EvaluationPlan`    | 评价器版本、规则、指标、权重和反馈等级         | 确定性裁决优先，AI 只做解释                              |
| `SkillPack`         | 通用协议 Skill 之外的场景/角色行为包           | 发布时固定内容哈希                                       |

场景生命周期：

```text
DRAFT → VALIDATING → PUBLISHED → RETIRED
  └─────────────── validation failed ─→ DRAFT
```

这里的 `PUBLISHED/RETIRED` 是由 append-only `ScenarioVersionLifecycleEvent` 折叠得到的目录状态，不是对不可变版本正文的 update。`:retire` 只阻止新 Run 继续选用该版本；已有 Run、hash 和回放不受影响。

发布动作至少验证：

- 中英文必填内容完整；
- 必需角色数、人数上下限、最少不同 RunAgent 数和团队汇流任务合法；
- Task DAG 无环、Barrier 引用存在且可达；
- 每个必需 Task 都有评价方案和反馈策略；
- 隐藏 Outcome、未来 Inject 和私有反馈不会提前泄漏；
- 数据来源、许可、Schema、Skill、规则和 Fixture 均有哈希；
- 场景声明 `minDistinctRequiredAgents >= 2`；首个永定河版本为 4。一个 RunAgent 可以获得辅助角色，但同一实例不能重复计入必需角色就绪 quorum。

### 5.2 Agent 目录与版本

| 实体            | 作用                                                                               | 关键规则                                   |
| --------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| `AgentIdentity` | 所有者、显示名、注册状态和说明                                                     | 可撤销目录身份，不等于一次运行实例         |
| `AgentVersion`  | provider/model 约束、能力、Skill/Tool manifest、协议版本、Telemetry 能力和内容哈希 | 发布后不可变；不能存放长期明文凭据         |
| `RunAgent`      | 某 AgentVersion 在一个 Run 中的一次实例                                            | 固定 agent version；同一版本可启动多个实例 |

`AgentVersion` 只描述可复现配置和声明能力，不证明参训者自报的模型或 Tool 真实执行。运行期身份、权限和 Telemetry trust 仍由服务端绑定的 RunAgent credential 与平台事件决定。

AgentIdentity lifecycle 为 `ACTIVE ↔ SUSPENDED → REVOKED`，REVOKED 终态不可恢复；AgentVersion 为 `DRAFT → PUBLISHED → RETIRED`。所有变化追加 lifecycle event，正文不变。SUSPENDED 立即拒绝新命令、join、credential 签发/轮换，并把活跃 RunAgent 标为 DISCONNECTED；恢复后由 operator 显式重新激活。REVOKED 还会撤销全部 credential、阻止所有新 Run，并把未完成 RunAgent 转为 REMOVED，触发其可重分配 Task 的租约释放事件。

### 5.3 运行侧

| 实体                                | 作用                                              |
| ----------------------------------- | ------------------------------------------------- |
| `ExerciseRun`                       | 场景版本、模式、当前阶段、虚拟时钟和总生命周期    |
| `RunHumanMember`                    | operator、reviewer、observer；与参训 Agent 分离   |
| `RunTeam`                           | 团队边界；首期一个 Run 默认一个团队               |
| `RunAgent`                          | 某个 AgentVersion 在本 Run 中的一次实例           |
| `RunRoleSlot` / `RunRoleAssignment` | 角色槽位及带有效事件区间的分配历史                |
| `RunTask`                           | 可并行的工作单元，拥有独立状态和 `lock_version`   |
| `RunTaskClaim`                      | 带租约的认领记录；同一时刻只能有一个有效认领      |
| `RunBarrier`                        | 汇总 Task/Evaluation/Endorsement 后一次性释放下游 |
| `Message`                           | 有发送人及固定收件人快照的显式协作消息            |
| `Artifact` / `ArtifactVersion`      | 内容寻址、不可变、可分支/合并的协作工件           |
| `Submission`                        | Agent 代表个人、角色或团队提交的不可变结果        |
| `Evaluation`                        | 针对提交、Task、Agent、角色、团队或 Run 的评价    |
| `Feedback`                          | 面向个人、角色或团队的反馈及安全行动授权          |

Run 状态：

```text
CREATED → FORMING → READY → RUNNING ↔ PAUSED → COMPLETING → COMPLETED
                         └──────────────────→ CANCELLED / FAILED
```

Task 状态：

```text
BLOCKED → READY → CLAIMED → IN_PROGRESS → SUBMITTED → EVALUATING
                                      ↑                    ↓
                              REWORK_REQUIRED ←────────────┤
                                                          └→ ACCEPTED
```

Barrier 状态：

```text
CLOSED → SATISFIED → RELEASED
```

Barrier 释放后不可回关。需要纠错时创建补救 Task，或从事件点 Fork 新 Run，不能修改历史。

Run 进入 `READY` 前，数据库和领域状态机同时验证：每个必需 RoleSlot 恰有一个有效主分配、这些主分配对应不同的 `run_agent_id`，且不同 RunAgent 数达到场景版本的 `minDistinctRequiredAgents`。辅助角色不计入该 quorum。v1 compatibility Run 是唯一允许一个 legacy RunAgent 的例外。

## 6. 首个多智能体真实案例

现有“2023 永定河春季生态补水——京津冀多水源联合调度（事实锚定合成版）”升级为四角色协作案例：

| 角色             | 私有/定向输入                  | 主要输出                     |
| ---------------- | ------------------------------ | ---------------------------- |
| 水情与证据智能体 | 官方流量、来源、时态和修订记录 | 证据清单与来水摘要工件       |
| 水动力约束智能体 | 河道、断面、损失和传播规则     | 断面响应与容量约束工件       |
| 生态目标智能体   | 目标区间、连续性和水质边界     | 生态目标风险与优先级工件     |
| 调度协调智能体   | 三类显式共享工件和团队反馈     | 候选联合方案、团队提交与修订 |

```text
水情证据 ───────┐
水动力约束 ─────┼─ 并行 Task ─→ analysis-ready Barrier
生态目标 ───────┘                     │
                                      ▼
                               调度协调与团队提交
                                      │
                                      ▼
                              确定性 Evaluation
                               ├─ 个人定向反馈
                               ├─ 角色反馈
                               └─ 团队反馈
                                      │
                                      ▼
                         并行修订 → endorsement Barrier
```

调度协调智能体不能读取其他智能体未发布的内部上下文。团队提交引用 ArtifactVersion、Evidence Receipt 和 endorsement；平台据 Artifact 作者、消息/Receipt、endorsement 和领域事件推导 `contributor_run_agent_ids`。协调 Agent 自报的贡献名单只能保存为 `participant_reported`，不能直接成为个人归因事实。

## 7. 多智能体并发与一致性

### 7.1 Task 认领

- 不同 Task 的状态竞争只锁各自 Task 行，不锁 Run 生命周期行。
- 同一 Task 的竞争认领在短事务中使用行锁；只有一个有效租约。
- Worker 继续使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 领取评价任务。
- 租约过期可恢复，但 claim、renew、release 都追加领域事件。

完整回放需要全 Run 的确定总序。每个事务在业务校验完成后，短暂锁定独立的 `run_event_heads(run_id, next_seq, head_hash)` 行，为本事务的一个或多个 Event 分配连续 `run_seq`、计算 hash chain 并插入 Outbox，然后一起提交。这个微小序列化点不等于锁 Run 状态；失败时 Task 变化和 Event head 一起回滚。

Task claim/recovery 转换：

| 命令/触发            | 起点                | 守卫                                       | 终点                              | 领域事件                       |
| -------------------- | ------------------- | ------------------------------------------ | --------------------------------- | ------------------------------ |
| `claim`              | READY               | 无有效租约；Task version 匹配              | CLAIMED                           | `task.claimed`                 |
| `begin`              | CLAIMED             | claimant/lease token 匹配且未过期          | IN_PROGRESS                       | `task.started`                 |
| `heartbeat`          | CLAIMED/IN_PROGRESS | 当前 claimant；未过期；未超最大租期        | 原状态                            | `task.lease_renewed`           |
| `release`            | CLAIMED/IN_PROGRESS | 当前 claimant                              | READY；不可重分配 Task 则 BLOCKED | `task.released`                |
| lease reaper         | CLAIMED/IN_PROGRESS | `lease_expires_at <= now`                  | READY；不可重分配 Task 则 BLOCKED | `task.lease_expired`           |
| Agent suspend/remove | CLAIMED/IN_PROGRESS | credential/Agent 状态失效                  | READY；不可重分配 Task 则 BLOCKED | `task.released_by_agent_state` |
| `submit`             | IN_PROGRESS         | claimant、lease token、Task version 都有效 | SUBMITTED                         | `task.submitted`               |

每次 claim 生成不可预测的 lease token 摘要和递增 `claim_epoch`。过期持有者即使稍后恢复也不能 heartbeat 或 submit；新 Agent 成功 claim 后旧 token 永久失效。评价基础设施重试只改变 Evaluation job，不退回 Task；dead letter 把 Task 放入明确的 manual hold，等待 operator 重试或取消。

### 7.2 Barrier 释放

- 每个输入以 `(barrier_id, condition_key, source_event_id)` 去重。
- 在 Barrier 行锁内计算满足条件并只释放一次。
- 释放下游 Task、Inject、Phase 和对应 Event 必须同一事务提交。

### 7.3 幂等和乐观并发

所有写命令要求：

- `Idempotency-Key`；
- actor RunAgent 或 Human Member；
- operation/resource scope；
- canonical request hash；
- 对已有聚合执行状态变更时，使用该聚合的 `If-Match` 或 SDK `expectedVersion`。

同 key、同 hash 返回原始状态码和响应；同 key、不同 hash 返回 `409 IDEMPOTENCY_CONFLICT`。Command receipt 保存响应快照或不可变对象引用和响应哈希。

版本检查必须落到最小聚合：Task 状态检查 Task ETag，Artifact 更新使用 `baseVersionId`，Scenario 草稿检查 draft ETag，Run 的 ETag 只用于 start/pause/advance/cancel 等全局状态。创建 Message、追加 Artifact/Submission、签发 credential 等命令以幂等键、目标 scope 和自身前置条件保护，不能为了 `If-Match` 去锁 Run，否则会重新制造全局并发冲突。

### 7.4 工件冲突

ArtifactVersion 使用内容寻址。更新必须带 `baseVersionId`；两个智能体从同一旧版本编辑时显式创建分支或返回 `ARTIFACT_BASE_CONFLICT`，绝不静默覆盖。

## 8. 权限、可见性与反馈

### 8.1 可见性范围

```text
Audience = agent | role | team | operator | reviewer
```

“角色可见”或“团队可见”在发送/发布时展开为固定收件人快照。后来加入的 Agent 默认不能回看历史内容；若场景允许回填，系统必须追加 `disclosure.granted` 和新的 Receipt。

| 内容                              |   本 Agent |     同角色 |     同团队 |     Operator |  Reviewer/Internal |
| --------------------------------- | ---------: | ---------: | ---------: | -----------: | -----------------: |
| 本人 Receipt、私有 Task、个人反馈 |         是 |         否 |         否 |       按授权 |         按评审任务 |
| 角色消息/工件/反馈                | 收件快照内 | 收件快照内 |     不自动 |           是 |             按授权 |
| 团队共享工件/反馈                 | 收件快照内 | 收件快照内 | 收件快照内 |           是 |             按授权 |
| 他人私有提交或 Trace 内容         |         否 |         否 |         否 |       按授权 |         按评审任务 |
| 隐藏 Outcome/评分规则             |         否 |         否 |         否 | 按 clearance | evaluator/internal |

外部 Agent 默认只走 Fastify HTTP/MCP，不直接获得 Supabase Data API 表权限。`auth.uid()` 只能证明所有者，不能区分同一用户启动的多个 Agent 实例；API Token 必须绑定可撤销的 `run_agent_id`。

RunAgent credential 使用独立模型：`run_agent_credentials(id, run_agent_id, token_hash, scopes, issued_at, expires_at, revoked_at, rotated_from_id)`。原始 token 只在签发响应出现一次，数据库仅存带 key-id 的慢哈希/摘要。Token scope 同时限制 Run、Task 操作和可选 Telemetry Ingress；暂停/移除 Agent、Run 结束、显式撤销或轮换会立刻使 credential 无效。签发、轮换、撤销都要求 operator 权限、幂等键，并追加 Event/Command receipt。

### 8.2 分层反馈

Feedback 明确包含：

- `target_scope = individual | role | team`；
- 发送者、接收者快照和可见性；
- 所依据的 Evaluation、Metric 和可见证据；
- 具体 Agent/Task 的 `feedback_action_grant`；
- 中英文安全说明及下一步动作。

`feedback_action_grant` 是可消费授权，而不是 UI 字符串：

```text
id, target_run_agent_id, target_task_id,
action = revise_task | resubmit | endorse | request_clarification,
predecessor_submission_id?, evaluation_id,
issued_run_seq, expires_virtual_at?, expires_at?,
max_uses, used_count, revoked_run_seq?, scope_hash
```

后续命令必须携带 `feedbackActionGrantId`。服务端在目标 Task/Grant 行锁内验证 Agent、Task、action、predecessor、有效期、次数、撤销和 scope hash，成功命令与 `feedback_action_grant.consumed` Event 同事务提交。Grant 不可转让、不可跨 Task 使用；修订产生新 Submission，绝不覆盖 predecessor。

团队高分不能自动赋给个人。`evaluation_attributions` 将指标链接到 Task、Submission、Artifact、Message 或 RunAgent；无法可靠归因的指标只保留在团队层。

## 9. 权威事件与“当时视角”回放

### 9.1 RunEvent

每个事件至少包含：

```text
event_id, run_id, run_seq, stream_type, stream_id, event_type,
actor_type, actor_id, correlation_id, causation_id,
virtual_time, occurred_at, recorded_at, schema_version,
assertion_class, payload_inline_or_blob_ref, payload_hash, previous_hash,
trace_id?, span_id?
```

`assertion_class` 区分：

- `platform_observed`：平台直接观察的事实；
- `participant_reported`：参训者提交的断言；
- `evaluator_derived`：固定评价器产生的派生结果；
- `operator_asserted`：导调人员命令；
- `external_outcome`：受控导入的外部结果。

状态修改、Event、Outbox 和必要 Receipt 必须同一事务提交。

### 9.2 AgentViewReceipt

不能用“今天的 RLS 和成员关系”重算某 Agent 当时看到了什么。v2 只通过 `/sync` 发放新的 participant-visible 内容；每个实际进入 delivery batch 的资源先固化成不可变 issuance Receipt：

```text
id, run_id, run_agent_id, agent_receipt_seq,
delivery_batch_id, source_event_id, source_run_seq, issued_event_id, issued_run_seq,
view_kind, resource_type, resource_id, resource_version,
available_virtual_at, issued_virtual_at, issued_at,
schema_version, content_snapshot_or_blob_ref, content_hash,
previous_receipt_hash, receipt_hash
```

确认不会回写 Receipt，而是追加另一类不可变记录：

```text
agent_view_acknowledgements:
  run_agent_id, delivery_batch_id, through_receipt_seq,
  acknowledged_head_hash, acknowledged_event_id,
  acknowledged_run_seq, acknowledged_at, command_receipt_id
```

acknowledgement 必须验证 `through_receipt_seq` 与 `acknowledged_head_hash` 正好对应同一 Agent 的 Receipt chain；同幂等命令返回同一确认记录。

按 `atRunSeq` 回放时只纳入 `issued_run_seq <= cutoff` 的 Receipt；只有 `acknowledged_run_seq <= cutoff` 的 acknowledgement 才能把它升级为 acknowledged。Eligibility 同样读取带 `granted_run_seq` 的 disclosure/availability grant。wall clock 仅用于展示，不能替代这些领域序号。

Replay 有三种严格的 delivery 语义：

1. `acknowledged`：存在 issuance Receipt，且后续 acknowledgement 覆盖该序号；最强的“已见”证据。
2. `issued`：存在不可变 Receipt；服务端已固化并尝试返回，但网络层不能证明最终收到。
3. `eligible`：来自当时的 `event_disclosure` 或 availability grant，且不存在对应 Receipt；它是可获取投影，不是 Receipt，也不能称为 Agent 已知。

Replay cursor 以 `run_seq` 为权威切点，同时展示虚拟时间。纠正信息不覆盖旧 Receipt；在新 Receipt 到达后两条记录同时存在。回放 manifest 返回场景/策略哈希、Event chain head、Agent receipt chain head 和校验结果。

Receipt 采用 canonical JSON 和逐 Agent hash chain。阶段结束和 Run 完成时，把所有 chain head 写入 `run_attestations` 并用部署密钥签名或锚定到 WORM 对象；仅在数据库内重算 hash 不能抵御拥有超级权限的攻击者。

### 9.3 `/sync` 交付协议与 Agent knowledge-set

`POST /api/v2/runs/{runId}/sync` 是**唯一**把新 Inject、Task assignment、Message、Artifact grant 和 Feedback 发给 RunAgent 的入口：

```json
{
  "afterReceiptSeq": 17,
  "ack": {
    "throughReceiptSeq": 17,
    "headHash": "sha256:..."
  },
  "maxItems": 50
}
```

响应：

```json
{
  "deliveryBatchId": "batch_...",
  "fromReceiptSeq": 18,
  "throughReceiptSeq": 22,
  "receiptHeadHash": "sha256:...",
  "runCursor": 184,
  "hasMore": false,
  "receipts": []
}
```

该写请求必须带 `Idempotency-Key`。服务端在同一事务中校验/追加 acknowledgement、选择在当前 `run_seq` 已 eligible 且尚未 issued 的 disclosure、固化 batch/Receipt、分配 Event 序号并保存 Command receipt。同一 actor/key/hash 重试返回原 batch，即使期间出现了新 Inject；不同 hash 返回 409。空结果也返回可对账的稳定 batch。

`GET /tasks|messages|artifacts|feedback` 只对已经通过 Receipt 发放的资源做恢复/分页，不生成 Receipt，也不能把仅 eligible 的内容提前变为可见；客户端要获取新内容必须再次 `/sync`。

在 cutoff 的严格 Agent knowledge-set 定义为：

```text
agentKnowledgeAt(cutoff, deliverySemantics) =
  平台在 cutoff 前接受、且 actor 是该 RunAgent 的命令/Message/Artifact/Submission
  ∪ cutoff 前通过 Receipt issued 给该 Agent 的资源
  ∩ deliverySemantics 对 acknowledgement 的筛选
```

`eligible` 是导调员用于检查潜在可获取面的反事实投影，不属于 Agent knowledge-set。被拒绝的命令可出现在该 Agent 自身命令历史中，但不会产生成功领域对象；其他 Agent 不可见。

## 10. OpenTelemetry 可观测设计

### 10.1 为什么采用 OTel、又不把它当事实源

OTel 的 Span 只有一个 parent，而 Span Link 可以跨 Trace 表达 scatter/gather 与异步因果关系，适合多智能体汇聚。采样、Collector、网络和保留策略都可能造成观测缺口，所以 Trace 不可替代数据库事件与 Receipt。[OTel Trace API](https://opentelemetry.io/docs/specs/otel/trace/api/) · [Sampling](https://opentelemetry.io/docs/concepts/sampling/)

GenAI、Agent、Tool 和 MCP 语义约定目前仍处于 Development，并已移到独立 GenAI 约定仓库。WISER 必须用 `TelemetryConventionAdapter` 固定内部 DTO，不能让领域模型或 UI 直接依赖实验字段。[Semantic convention stability](https://opentelemetry.io/docs/specs/semconv/general/semantic-convention-groups/) · [GenAI attributes](https://opentelemetry.io/docs/specs/semconv/registry/attributes/gen-ai/)

### 10.2 观测来源、接入与信任

`traceparent` 只能关联上下游，不能让平台凭空获得外部 Agent 内部的模型或 Tool Span。v2 明确区分两种可见深度：

1. **EXCON 边界观测**：所有 Agent 都有。平台记录 HTTP/MCP、Task 命令、队列、Submission、Evaluation 和 Feedback 的服务端 Span；看不到外部运行时内部过程。
2. **参训者自报观测**：可选。外部 Agent 集成 WISER Telemetry SDK/Skill wrapper 或兼容 OTel exporter，经认证的 Telemetry Ingress 上报 Agent turn、模型和 Tool Span。没有 exporter 时 UI 绝不能伪造这些内部 Span。

Telemetry Ingress 使用与业务 Token 分离、绑定 `run_agent_id`/Run 的短期 scope；覆盖客户端提交的身份 Resource attributes，禁止冒充其他 Agent 或 `excon_service`。入口执行属性 allowlist、正文拒绝、payload/span 数量与时长限制、速率配额和 trace context 校验，再转发 Collector。Collector 不直接暴露给参训者。

每个 Span/Log 带不可由客户端覆盖的来源标签：

```text
wiser.telemetry.source = excon_service | participant_exporter
wiser.telemetry.trust = platform_observed | participant_reported
wiser.agent.session.id = <server-bound identity>
```

`participant_reported` Telemetry 只用于诊断，不能驱动 Barrier、授权、确定性得分或审计结论。即使本机 Codex 的 Skill wrapper 能观测 HTTP/MCP/Tool 边界，也只有在运行时实际导出模型调用时才能展示 model Span。

Coverage 不能只显示一个含义模糊的百分比。读模型分别返回 `boundaryCoverage`、`participantTelemetryMode = none | partial | instrumented`、dropped count、late span count 和保留窗口；UI 同时显示“平台观测”或“参训者自报”信任徽标。

### 10.3 Run 与 Trace 的映射

Run 是业务相关范围，不是一条 Trace。建议每个 Agent turn、异步 Task、团队提交和 Evaluation 各自形成短 Trace：

```text
dispatch trace
   ├─link→ water-evidence turn trace
   ├─link→ hydraulic turn trace
   └─link→ ecology turn trace

artifact A ─┐
artifact B ─┼─links→ coordinator / team submission trace
artifact C ─┘

team submission ─links→ evaluation trace
evaluation/feedback ─link→ affected agent next-turn trace
```

聚合评价不能伪造一个唯一 parent；它通过 Links 指向所有被评价来源。Link 属性至少包含关系、领域 event id 和来源 Agent。大规模汇聚时链接批次 envelope，完整依赖边仍保存在 PostgreSQL。

### 10.4 Span 约定

| WISER 操作        | Span 表达                                                            |
| ----------------- | -------------------------------------------------------------------- |
| Agent turn        | `invoke_agent {role}` 根 Span，或稳定的 `wiser.agent.turn` 包装 Span |
| 模型请求          | `chat {model}` / `generate_content {model}` CLIENT Span              |
| Tool 调用         | `execute_tool {tool}`；MCP 补充 `mcp.method.name=tools/call`         |
| Task / Submission | `wiser.task.execute` / `wiser.submission.process`                    |
| Evaluation        | `wiser.evaluation.run`，规则可为子 Span 或 checkpoint                |
| Feedback          | `wiser.feedback.deliver`，后续 turn 用 Link 指回                     |
| 运行日志          | 携带 TraceId/SpanId 的 OTel LogRecord                                |

稳定内部属性：

```text
wiser.scenario.id
wiser.scenario.version
wiser.exercise.run.id
wiser.agent.session.id
wiser.agent.role
wiser.virtual_time
wiser.event.sequence
wiser.checkpoint.id
wiser.telemetry.source
wiser.telemetry.trust
```

外部系统传播 W3C `traceparent`/`tracestate`。MCP 的传播元数据与 HTTP transport Span 分开，并通过 Link 关联。Run/Agent ID 优先显式放入应用协议，而不是装入会跨进程传播的敏感 Baggage。

### 10.5 敏感数据

默认禁止把以下正文放入 Span attributes、events 或 logs：system prompt、消息输入输出、Tool 参数和结果、隐藏规则/Outcome、Feedback 正文、Submission 正文、思维链、身份、凭证和私有水务数据。

记录 ID、分类、类型、大小、状态、模型、provider、token、时延和授权后的不可逆摘要。正文存放在 Supabase private schema 或 Storage。OTel 对 GenAI 内容字段采用 opt-in 思路；Collector redaction 只能是第二道防线，首要原则是在应用侧不采集。[OTel sensitive data guidance](https://opentelemetry.io/docs/security/handling-sensitive-data/)

### 10.6 采样和指标

- 初期演练量低：所有 `wiser.*` Trace 100% 采集，便于真实案例 TDD。
- 扩容后：尾采样保留全部错误、超时、评价失败、人工干预和指定 Run；普通成功 Trace 概率采样。
- 所有关联根 Trace 都显式设置保留属性，不能假设 Links 会让整组 Trace 自动保留。
- PostgreSQL Event 和 Receipt 永远 100% 保存。
- Metrics 标签不含 run UUID、event UUID 或用户 ID 等高基数值。

### 10.7 Compose 观测栈

默认只选一套 Trace 后端：

```text
WISER processes ─────────────────OTLP────► OTel Collector Contrib
Participant exporter ─► Authenticated ───►  ├─ traces  → Tempo
                        Telemetry Ingress     ├─ metrics → Prometheus
                                              └─ logs    → Loki（可选 profile）

Grafana ── Tempo + Prometheus + Loki
```

开发用 `observability` Compose profile；Tempo 使用单体模式和本地持久卷，生产再切对象存储。Tempo 没有内建认证，不能直接暴露。Grafana 的 Trace timeline、critical path、Span Links、Trace correlation 和 Service Graph 用于技术深查；WISER 自己从领域事件构建 Run 级协作 DAG 和完整回放。[Grafana trace view](https://grafana.com/docs/grafana/latest/visualizations/explore/trace-integration/) · [Service Graph](https://grafana.com/docs/grafana/latest/datasources/tempo/service-graph/)

## 11. 前端信息架构

### 11.1 路由

观察与公开区域：

```text
/{locale}/scenarios
/{locale}/scenarios/{scenarioId}
/{locale}/scenarios/{scenarioId}/versions/{versionId}
/{locale}/runs
/{locale}/runs/{runId}/overview
/{locale}/runs/{runId}/agents
/{locale}/runs/{runId}/trace
/{locale}/runs/{runId}/replay
/{locale}/runs/{runId}/submissions
/{locale}/runs/{runId}/evaluations
/{locale}/compare
```

管理员区域：

```text
/{locale}/manage/scenarios
/{locale}/manage/scenarios/{scenarioId}
/{locale}/manage/scenarios/{scenarioId}/versions/{versionId}
/{locale}/manage/runs/{runId}
```

`/`、`/zh-CN` 和 `/en` 进入各自语言的场景中心。语言切换只替换 locale 段，并保留 scenario、run、span、cursor 和筛选 query。

### 11.2 场景中心与场景编排

公开场景中心只展示流域签名、公开说明、当前/历史发布版本、必需角色数和明确允许公开的 Run 汇总。草稿是否存在、校验错误、发布就绪度、内部负责人和未发布来源都只能出现在 `/manage/scenarios` 的管理员读模型。M0 静态界面是明确标识的本地 operator design preview；生产不能据此前端 fixture 推断匿名权限。

管理场景中心展示草稿状态、版本 diff、最近编辑活动和发布就绪度。场景编辑区按以下步骤组织：

```text
基本信息 → 水系统/数据 → 阶段与 Inject → 角色与 Task
        → 可见性矩阵 → 评价与反馈 → Skill 发布清单
        → 校验报告 → 发布不可变版本
```

发布版本只读；任何修改都从该版本 Fork 新草稿。服务端分别返回 `PublicScenarioSummaryDto` 和 `ManageScenarioSummaryDto`；普通观察者不仅看不到写按钮，也无法通过 API、计数、404 差异或错误详情推断草稿及校验结果。

### 11.3 Run 导调台

```text
┌ 场景 / 版本 / Run       [运行中] [只读观测]                 ┐
│ 虚拟 T+12:00 │ 4 Agent │ 边界观测 100% │ 参训自报 3/4       │
│ Overview | Agent | Trace | Replay | Submission | Evaluation │
├───────────────┬────────────────────────────┬────────────────┤
│ Agent roster  │ 双时钟 waterfall           │ Span inspector │
│ EXCON         │ ━ Inject ━ Evaluation      │ Attributes     │
│ 水情 A        │   invoke_agent ━ tool      │ Events / Logs  │
│ 水动力 B      │   invoke_agent ━━━━━       │ Span Links     │
│ 生态 C        │       analyze ━ artifact   │ Domain event   │
│ 协调 D        │                submit ━    │ Telemetry gap  │
├───────────────┴────────────────────────────┴────────────────┤
│ Domain overlay: Receipt → Artifact → Submission → Feedback │
└─────────────────────────────────────────────────────────────┘
```

默认按 Agent 泳道，可切换按 Service。顶部轴是实际时间和 duration；领域标记显示 `run_seq`、虚拟时间、Checkpoint、Inject、Submission 和 Feedback。三种图必须分开命名：水系统拓扑、Agent 协作图、技术 Service Graph。

Trace 页面借鉴 OTel/Grafana/Jaeger 的交互：搜索、minimap、缩放、折叠树、critical path、错误/慢调用/重复工具循环筛选、Span attributes/events/links、Trace→Log/Metric 跳转。WISER 的差异是多 Trace 的 Run 级汇流，而不是一次只看一条 Trace。

### 11.4 全程回放

```text
┌ [播放] [上个关卡] [下个错误]   视角：[生态目标 Agent ▼]     ┐
│ run_seq #184 ━━━━━●━━━━━━━━  T+12:04 / wall 10:32:11      │
├──────────────────┬────────────────────┬────────────────────┤
│ 截止此刻水系状态 │ Agent/Task/工件状态 │ 当前 Event / Span  │
├──────────────────┴────────────────────┴────────────────────┤
│ 仅显示该 Agent 截止此刻 acknowledged/issued 的 Receipt    │
└─────────────────────────────────────────────────────────────┘
```

Replay cursor 驱动服务端 as-of projection，而不是只在浏览器隐藏未来列表项。响应严格拆成两层：

- `authoritativeProjection`：按 `run_seq` 重建水系统、Run/Task/Agent、issued Inject payload/Receipt、协作工件、提交修订、评价和已送达反馈；它进入签名 replay manifest。
- `bestEffortTelemetryOverlay`：按权限叠加可能采样、迟到或过期的 Trace/Log，并返回 source/trust/coverage/dropped 标记；它不进入 Agent-known 集、确定性评分、Event/Receipt hash 或签名 manifest。

### 11.5 视觉系统

视觉签名是“**协作河网 / 双时钟汇流轴**”：多 Agent 泳道像支流并行，在 Team Submission、Evaluation 和 Feedback 处汇流/分流；曲线只表达真实 Span Links。

```text
Abyss      #071C2B  Trace 画布
Channel    #12384E  深色面板
River      #2C86AE  主交互
Ripple     #67BFD1  观测与活动
Gauge      #D89C39  当前时点/警示
Floodplain #F3F7F8  应用背景
Fault      #B64B4B  错误
```

场景名称采用中文衬线字体；UI 正文采用 IBM Plex Sans/Noto Sans SC 系列；时间、ID 和 Trace 数据采用等宽字体。桌面是固定上下文栏和三栏工作区；平板把 Inspector 变抽屉；手机把 waterfall 降级为按智能体筛选的可访问事件流。所有图形都提供表格/列表替代。

## 12. API v2 边界

### 12.1 公开场景目录与管理员场景 API

```text
GET    /api/v2/scenarios
GET    /api/v2/scenarios/{scenarioId}
GET    /api/v2/scenarios/{scenarioId}/versions
GET    /api/v2/scenario-versions/{versionId}

GET    /api/v2/manage/scenarios
POST   /api/v2/manage/scenarios
GET    /api/v2/manage/scenarios/{scenarioId}
PATCH  /api/v2/manage/scenarios/{scenarioId}
POST   /api/v2/manage/scenarios/{scenarioId}/versions
PUT    /api/v2/manage/scenario-versions/{versionId}/blueprint
POST   /api/v2/manage/scenario-versions/{versionId}:validate
POST   /api/v2/manage/scenario-versions/{versionId}:publish
POST   /api/v2/manage/scenario-versions/{versionId}:retire
POST   /api/v2/manage/scenario-versions/{versionId}:fork
```

前三个公开 GET 只返回 published/retired 的公开字段。所有 draft、validation 和 readiness 字段只存在于 `ManageScenarioSummaryDto`，不能通过公共 DTO 置空字段来“隐藏”。

### 12.2 Agent 目录

```text
GET    /api/v2/agents
POST   /api/v2/agents
GET    /api/v2/agents/{agentId}
POST   /api/v2/agents/{agentId}/versions
GET    /api/v2/agent-versions/{agentVersionId}
POST   /api/v2/agents/{agentId}:suspend
POST   /api/v2/agents/{agentId}:resume
POST   /api/v2/agents/{agentId}:revoke
POST   /api/v2/agent-versions/{agentVersionId}:retire
```

AgentVersion 内容发布后不可变；`:retire` 同样追加 lifecycle event。`POST /runs/{runId}/agents` 必须携带 `agentVersionId`、唯一 `instanceKey` 和待占用 `roleSlotId`，返回新的 RunAgent 实例，而不是修改 AgentVersion。

### 12.3 Run 与编组

```text
POST   /api/v2/runs
GET    /api/v2/runs
GET    /api/v2/runs/{runId}
POST   /api/v2/runs/{runId}/agents
GET    /api/v2/runs/{runId}/agents
PUT    /api/v2/runs/{runId}/role-assignments
POST   /api/v2/runs/{runId}:start|pause|resume|advance|cancel
GET    /api/v2/runs/{runId}/topology
```

普通 Agent 无权推进虚拟时钟。协调 Agent 只能提交 `phase-ready`；EXCON 仍检查 Barrier。

### 12.4 Agent 协作

```text
GET    /api/v2/runs/{runId}/me
POST   /api/v2/runs/{runId}/sync
GET    /api/v2/runs/{runId}/tasks
POST   /api/v2/tasks/{taskId}:claim|heartbeat|release
POST   /api/v2/tasks/{taskId}/submissions
POST   /api/v2/submissions/{submissionId}/endorsements
POST   /api/v2/runs/{runId}/messages
GET    /api/v2/runs/{runId}/messages
POST   /api/v2/runs/{runId}/artifacts
GET    /api/v2/runs/{runId}/artifacts
POST   /api/v2/artifacts/{artifactId}/versions
GET    /api/v2/runs/{runId}/submissions
GET    /api/v2/runs/{runId}/evaluations
GET    /api/v2/runs/{runId}/feedback
```

### 12.5 事件、回放与可观测性

```text
GET /api/v2/runs/{runId}/events
GET /api/v2/runs/{runId}/snapshot
GET /api/v2/runs/{runId}/replay
GET /api/v2/runs/{runId}/traces
GET /api/v2/traces/{traceId}
GET /api/v2/runs/{runId}/logs
GET /api/v2/runs/{runId}/scorecards
GET /api/v2/runs/{runId}/stream?after=
```

Operator 的显式导调命令使用独立权限，并和自动 Inject/Feedback 一样追加领域事件：

```text
GET  /api/v2/runs/{runId}/injects
POST /api/v2/runs/{runId}/injects
POST /api/v2/runs/{runId}/feedback
GET  /api/v2/runs/{runId}/delivery-batches/{batchId}
POST /api/v2/runs/{runId}/agents/{runAgentId}/credentials
POST /api/v2/runs/{runId}/agents/{runAgentId}/credentials:rotate
POST /api/v2/runs/{runId}/agents/{runAgentId}/credentials:revoke
```

Replay 参数：

```text
perspective=operator|team|role|agent
subjectId=...
atRunSeq=...
deliverySemantics=acknowledged|issued|eligible
```

Observer API 只返回安全 DTO；管理员 API 使用独立权限。关键 DTO 包括 `ScenarioSummaryDto`、`ScenarioVersionDetailDto`、`RunDetailDto`、`RunAgentDto`、`RunEventDto`、`RunAuthoritativeProjectionDto`、`BestEffortTelemetryOverlayDto`、`TraceSummaryDto`、`SpanDto`、`LogRecordDto` 和分层 Feedback DTO。

## 13. 数据库演进

建议增加而不是立即重命名现有表：

### 场景

```text
scenarios, scenario_versions, scenario_version_lifecycle_events,
scenario_role_definitions, scenario_phase_definitions,
scenario_task_definitions, scenario_task_dependencies,
scenario_barrier_definitions, scenario_inject_definitions,
scenario_visibility_policies,
scenario_evaluation_plans, scenario_skill_packs
```

### Run 与协作

```text
agent_identities, agent_identity_lifecycle_events,
agent_versions, agent_version_lifecycle_events,
exercise_runs, run_human_members, run_teams,
run_agents, run_role_slots, run_role_assignments,
run_phases, run_tasks, run_task_dependencies,
run_task_claims, run_barriers, run_barrier_inputs,
run_injects, view_delivery_batches,
run_channels, messages, message_recipient_snapshots,
artifacts, artifact_versions, artifact_version_parents,
artifact_grants, artifact_access_receipts
```

### 裁决与事实

```text
submissions, submission_evidence, submission_endorsements,
evaluation_jobs, evaluation_attempts, evaluation_results,
evaluation_metric_results, evaluation_attributions,
feedbacks, feedback_recipient_snapshots,
feedback_action_grants, feedback_receipts,
excon_private.run_events, excon_private.event_disclosures,
excon_private.agent_view_receipts,
excon_private.agent_view_acknowledgements,
excon_private.run_event_heads,
excon_private.telemetry_ingest_sessions,
excon_private.run_agent_credentials,
excon_private.command_receipts, excon_private.outbox,
excon_private.run_attestations
```

所有公开表启用 RLS，并检查真实所有权、成员关系和固定 recipient snapshot，而不只是 `TO authenticated`。隐藏 Outcome、规则、原始事件、Receipt、评价私证据和 command receipt 保持 private。

关键数据库约束：发布后的 ScenarioVersion/AgentVersion 正文及子表拒绝 update/delete；ScenarioVersion、AgentIdentity、AgentVersion lifecycle 只允许追加合法状态转换；必需 `run_role_assignments` 对 RoleSlot 唯一，且计入 quorum 的主分配对 RunAgent 唯一；`run_agent_credentials.token_hash` 唯一，过期/撤销 credential 不能认证；Receipt、acknowledgement、Event 和 hash head 只追加；所有身份、版本和 legacy 映射使用外键而不是字符串约定。

## 14. Skill 与 MCP v2

Skill 拆为：

- `agent-excon`：通用多智能体协议和安全循环；
- Scenario Skill Pack：永定河等案例的 Schema、规则和任务说明；
- Role Skill Pack：水情、水动力、生态、调度协调等职责。

通用 Agent loop：

1. 恢复 `runAgentId`，读取角色卡和当前 Task。
2. `sync` 拉取新 Receipt，确认上一 receipt chain head。
3. 认领 ready Task；业务状态只锁 Task，事件追加只短暂锁 run event head。
4. 只使用自身 Receipt 和授权 ArtifactVersion 构建证据集。
5. 通过 Message/Artifact 显式共享成果。
6. 提交 Task 结果并引用 Receipt/ArtifactVersion。
7. 分别处理个人、角色和团队反馈。
8. 修订、endorse 团队提交或等待 Barrier。
9. 除非有明确能力，不自行推进全局时钟。

建议 MCP Tools：

```text
excon_get_assignment, excon_sync, excon_list_tasks,
excon_claim_task, excon_submit_task_result,
excon_post_message, excon_publish_artifact,
excon_endorse_submission, excon_get_feedback,
excon_get_replay_cursor
```

MCP 仍只调用 HTTP。Scenario/Role Skill 的固定哈希说明可作为 MCP Resources 暴露。

## 15. v1 兼容迁移

### 15.1 准备与活跃 Episode 切换（M2）

1. 新建 v2 表、`legacy_episode_map(episode_id, run_id, run_agent_id, legacy_task_id)` 和旧表写保护触发器，同时保留 v1 路由。
2. 为旧永定河 v1 生成兼容蓝图：一个 legacy 角色、每阶段一个 Task；它只用于兼容，不允许成为新的 v2 发布场景。
3. 现有 `participant_versions` 一对一回填为不可变 AgentVersion，并保留原 UUID/内容哈希映射。
4. 在 Facade 切换前，对所有未完成 Episode 做一次受控、可回滚的 eager migration 和投影对账。极少数遗漏对象在第一次 v1 写入时，以 `SERIALIZABLE` 事务原子创建映射并迁移；唯一约束保证只发生一次。
5. Episode 一旦存在 map，旧事实表对该 Episode 立即拒绝写入；v1 observe/submit/advance/events 全部经 Facade 只写/读 v2。`episodeVersion` 由独立 v1 projection 维护，不能等同于 Run lock version。

M2–M5 期间没有双写窗口：活跃对象在 cutover 前或首次写入时迁移，冷的 completed 历史可以等待 M5。

### 15.2 Credential exchange

旧凭据不复制为新 token：

- 使用 Supabase 会话的主体以当前有效 JWT 调用一次 exchange，获得绑定具体 RunAgent、带 expiry/scope 的短期 credential。
- 旧的散列 participant API token 只在受限的 `/api/v1/credentials:exchange` grace window 验证一次；成功后原 token 标记 exchanged/revoked，新的原始 token 只返回一次。
- 无法证明旧身份时，由 operator 重新签发；绝不从数据库恢复或记录明文 token。

客户端在 v1 响应中的 `credentialMigration` 链接完成领取；grace window 结束后未交换的旧 token 返回稳定 `CREDENTIAL_REISSUE_REQUIRED`。

### 15.3 冷历史回填（M5）

Episode 回填为 Run；v1 Observation 导入为 `deliverySemantics=issued` 的 Receipt，同时标记 `provenance=legacy_import`、`deliveryConfidence=unknown`。`issued_run_seq` 是导入事件序号，旧访问时间只作为来源字段，且绝不伪造 acknowledgement。

Submission/Feedback 归入 legacy Task；原 observation/event id、payload hash、原事件 hash 和迁移批次签名全部保留。原 Event 通过 `legacy.event_imported` 关联，不冒充原生 v2 Event。迁移完成且调用量归零后，旧事实表整体只读，再关闭 v1 写端点。

## 16. TDD 验收矩阵

### 16.1 领域与并发

- Agent A、B 在不同 Task 同时提交，均成功，不发生 Run 全局版本冲突。
- 一个 RunAgent 同时占四个必需角色时，Run 不能进入 `READY`；四个不同实例占位后才可启动。
- 同一 Task 两个 Agent 同时 claim，只有一个有效租约。
- 租约过期后另一 Agent 可重新 claim；旧 claimant 的 heartbeat/submit 被稳定拒绝。
- 多个 Task 同时完成时 Barrier 只释放一次。
- 同幂等键/同 canonical hash 返回原状态码与响应；同键/不同 hash 返回 409。
- 两个 Agent 从同一 Artifact base 更新时产生显式分支或 `ARTIFACT_BASE_CONFLICT`，不覆盖彼此。
- 某 Task 进入评价不阻止其他 Task sync、message、artifact 或 submit。
- 团队 Submission 缺规定角色 endorsement 时不能进入评价。
- 角色级 Feedback 只对发放时的角色收件人快照可见，并能归因到该角色的 Task/Artifact；其他角色和后来加入者不可见。
- `/sync` 同幂等请求返回原 delivery batch，不重复生成 Receipt；普通 GET 不产生新 issuance。
- `feedback_action_grant` 过期、撤销、超次数、跨 Agent 或跨 Task 使用全部失败。
- Event、状态、Receipt 和 Outbox 在故障注入下要么一起提交，要么一起回滚。

### 16.2 可见性与回放

- Agent A 的回放不出现 B 的私有 Receipt payload、Submission、Feedback 或 Tool 内容。
- 角色变更不会追溯暴露历史消息；允许回填时必须存在 disclosure Receipt。
- 未拉取的 Inject 只出现在由 disclosure grant 计算的 `eligible`，不会产生 Receipt，也不出现在 `acknowledged`。
- acknowledgement 只追加新记录、不修改 Receipt；错误的 chain head 或越界序号被拒绝。
- 并行 Task 的 Event 通过短暂 event-head 锁获得无重复、无间隙的确定 `run_seq`。
- Receipt 内容、序号或顺序被修改时 hash 校验失败。
- 同一 `run_seq` 在 operator、team 和 agent 视角下生成不同且正确的 projection。
- 公共场景 DTO 无法读取或推断 draft、validation error 和 readiness。
- ScenarioVersion/AgentVersion 发布后正文 update/delete 失败，retire 只追加 lifecycle event。
- credential 过期或撤销后立即失败；轮换后旧 token 失效且新明文只返回一次。

### 16.3 Telemetry

- 三个并行 Agent turn 通过 Span Links 汇聚到团队 Submission，不能伪造多个 parent。
- Trace 缺失时领域回放仍完整，UI 显示 telemetry gap。
- 未集成 exporter 的 Agent 只显示 EXCON 边界 Span；UI 不生成虚假的 model/tool 内部过程。
- participant exporter 冒充其他 Agent 或平台服务时，入口覆盖身份并拒绝越权属性。
- `participant_reported` Span 不能改变 Barrier、权限、分数或审计事件。
- 任何 prompt、Tool 正文、隐藏 Outcome 或个人反馈都不会进入 OTLP。
- Log 能通过 trace/span 关联，领域事件能通过 event id 双向跳转。
- 虚拟时间与 wall clock 不混为同一轴。

### 16.4 前端与兼容

- 中文默认；英文路由结构和控件对齐，切换语言保留 Run/Span/cursor。
- 场景中心同时展示多个场景、版本和角色数。
- 导调台可按 Agent/角色/状态过滤，并回放单 Agent 当时视角。
- 普通 observer 看不到写控件；管理员只能修改草稿。
- 手机视图无水平溢出，图形有列表替代。
- v1 walking slice 通过 Facade 保持现有响应语义。

## 17. 增量交付计划

### M0 — v2 设计与前端参考纵切

- 本文档、双语架构摘要、场景中心和多 Agent Trace/Replay fixture。
- fixture 明确标记为设计预览，不静默伪装为在线 API。

### M1 — v2 Contracts 与只读 API

- 复数 Scenario/Version/Run/Agent/Trace DTO。
- 场景、Run、Agent、Event、Replay、Trace 的只读端点。
- Web 移除自动静默 fallback；错误、空态和 demo 模式可区分。

### M2 — 多 Agent 领域与数据库

- v2 表、RLS、Task/Barrier 状态机、Event/Receipt/Outbox 原子事务。
- 并发、幂等、可见性和 hash-chain pgTAP/集成测试。
- v1 在线 Facade 改为只写 v2，保持现有 HTTP/MCP 响应语义。

### M3 — Skill/MCP 多智能体协议

- 通用 Skill、四个角色 Skill Pack 和新 MCP Tools。
- 永定河多角色真实案例端到端 TDD。
- M3 使用 M2 已交付的最小 create/join/start API 和固定已发布 fixture；完整可视化场景编辑与人工导调命令仍在 M5。

### M4 — OTel Compose profile

- Collector、Tempo、Prometheus、Grafana；Loki 可选。
- Authenticated Telemetry Ingress、TelemetryConventionAdapter、身份覆盖、脱敏、trace correlation、分来源 coverage 和采样策略。

### M5 — 权威回放与管理命令

- 服务端 as-of projection、视角回放、场景草稿/校验/发布、Run 管理。
- v1 历史数据的保守 backfill、迁移证明、旧表只读和最终退役验证。

## 18. 完成定义

v2 的首个完整纵切不是“页面上出现四个 Agent 名称”，而是：

> 同一不可变永定河场景版本启动一个 Run，四个不同 RunAgent 获得不同 Receipt 并并行工作；它们通过显式 Artifact/Message 协作，Trace 通过 Span Links 汇聚到团队 Submission；确定性 Evaluation 分别向个人、角色和团队发放 Feedback；导调员能按 Agent 查看带来源信任标记的技术 Trace，并在任意 `run_seq` 切换视角而不看到该 Agent 当时尚未获得的信息。即使 OTel 数据缺失，领域事件回放仍然完整、可复算、可授权。
