export const YONGDING_SCENARIO_RESOURCE_URI =
  'excon://scenarios/jing-jin-ji-yongding-river';

export const YONGDING_SCENARIO_MARKDOWN = `# 京津冀永定河生态补水与多水源联合调度

## 使用边界

这是一个事实锚定的合成演练。水系统拓扑和水源类别以京津冀永定河为背景；水量、流量、阈值、约束、观测与结果全部是固定的合成数据，并标记为 \`simulation-only\`。本演练不连接实时控制系统，也不构成现实调度建议。

## 多智能体决策对象

- 水源：官厅水库下泄、南水北调中线来水、下游再生水。
- 合成控制断面：三家店、卢沟桥、屈家店及场景内的翠之汇营控制点。
- 四个独立角色：水情与水源证据、水力约束、生态目标、联合调度协调。每个 RunAgent 只使用自身 Receipt 链中的证据。
- 任务：通过 Message 和不可变 ArtifactVersion 协作，形成 24 小时联合调度方案；方案必须满足合成水源可用量、通道能力、传播时滞、生态目标和证据可见性约束。
- 时间线：导调中枢通过 \`sync\` 发放 Task、Inject/Message、Artifact grant 与 Feedback；参训智能体不能推进 Run 时钟或释放 Barrier。

## 推荐工具顺序

1. \`excon_get_assignment\` 核对身份、角色与 Receipt 游标。
2. \`excon_sync\` 发放新资源，并在后续调用中确认前一个链头。
3. \`excon_list_tasks\` 恢复已发放 Task，然后 claim、begin，必要时 heartbeat。
4. 用 Message 与 ArtifactVersion 协作，用 Receipt/ArtifactVersion 证据提交 Task 结果。
5. 通过 sync 处理分层 Feedback；只用匹配 ActionGrant 修订或背书。
6. 交接时使用 \`excon_get_replay_cursor\` 请求自身 issued/acknowledged 视角。

---

# Jing-Jin-Ji Yongding River ecological replenishment and multi-source allocation

## Usage boundary

This is a fact-anchored synthetic exercise. The water-system topology and source categories use the Jing-Jin-Ji Yongding River as context. Volumes, flows, thresholds, constraints, observations, and outcomes are fixed synthetic data marked \`simulation-only\`. The exercise is not connected to a live control system and must not be treated as operational advice.

## Multi-agent decision scope

- Sources: Guanting Reservoir release, South-to-North Water Diversion supply, and downstream reclaimed water.
- Synthetic control sections: Sanjiadian, Lugouqiao, Qujiadian, and the scenario's Cuizhihuiying control point.
- Independent roles: water/source evidence, hydraulic constraints, ecological targets, and joint-dispatch coordination. Each RunAgent uses only evidence in its own Receipt chain.
- Task: collaborate through Messages and immutable ArtifactVersions to form a 24-hour joint allocation plan satisfying synthetic availability, conveyance capacity, travel-time, ecological-target, and evidence-visibility constraints.
- Timeline: EXCON issues Tasks, Injects/Messages, Artifact grants, and Feedback through \`sync\`. Participant agents cannot advance the Run clock or release a Barrier.

## Recommended tool sequence

1. Use \`excon_get_assignment\` to reconcile identity, role, and Receipt cursor.
2. Use \`excon_sync\` to issue new resources and acknowledge the prior chain head on a later call.
3. Recover issued Tasks, then claim, begin, and heartbeat when needed.
4. Collaborate with Messages and ArtifactVersions; submit Task results with Receipt/ArtifactVersion evidence.
5. Process layered Feedback through sync and use only matching ActionGrants for revision or endorsement.
6. Handoff with \`excon_get_replay_cursor\` using only the agent's own issued/acknowledged perspective.
`;

export const YONGDING_V1_COMPATIBILITY_SCENARIO_MARKDOWN = `# 京津冀永定河生态补水与多水源联合调度（v1 兼容）

## 使用边界

这是仅用于显式 legacy Episode 任务的事实锚定合成演练。水系统拓扑和水源类别以京津冀永定河为背景；水量、流量、阈值、约束、观测与结果全部是固定合成数据，并标记为 \`simulation-only\`。本演练不连接实时控制系统，也不构成现实调度建议。

## 决策对象

- 水源：官厅水库下泄、南水北调中线来水、下游再生水。
- 合成控制断面：三家店、卢沟桥、屈家店及场景内的翠之汇营控制点。
- 任务：仅用当前 Episode 已交付的 Observation 提交 24 小时联合调度方案。

## v1 兼容工具顺序

1. \`excon_start_episode\`
2. \`excon_observe\`
3. \`excon_submit_allocation_plan\`
4. \`excon_get_feedback\`
5. 仅在 Feedback allowedActions 允许时调用 \`excon_advance\`

---

# Jing-Jin-Ji Yongding River ecological replenishment and multi-source allocation (v1 compatibility)

## Usage boundary

This fact-anchored synthetic exercise is available only for assignments that explicitly select the legacy Episode protocol. Water-system topology and source categories use the Jing-Jin-Ji Yongding River as context. Volumes, flows, thresholds, constraints, observations, and outcomes are fixed synthetic data marked \`simulation-only\`. It is not connected to live controls and is not operational advice.

## Decision scope

- Sources: Guanting Reservoir release, South-to-North Water Diversion supply, and downstream reclaimed water.
- Synthetic control sections: Sanjiadian, Lugouqiao, Qujiadian, and the scenario's Cuizhihuiying control point.
- Task: submit a 24-hour joint allocation plan using only Observations delivered to the current Episode.

## v1 compatibility tool sequence

1. \`excon_start_episode\`
2. \`excon_observe\`
3. \`excon_submit_allocation_plan\`
4. \`excon_get_feedback\`
5. Call \`excon_advance\` only when Feedback allowedActions permits it.
`;
