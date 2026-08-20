export const YONGDING_SCENARIO_RESOURCE_URI =
  'excon://scenarios/jing-jin-ji-yongding-river';

export const YONGDING_SCENARIO_MARKDOWN = `# 京津冀永定河生态补水与多水源联合调度

## 使用边界

这是一个事实锚定的合成演练。水系统拓扑和水源类别以京津冀永定河为背景；水量、流量、阈值、约束、观测与结果全部是固定的合成数据，并标记为 \`simulation-only\`。本演练不连接实时控制系统，也不构成现实调度建议。

## 决策对象

- 水源：官厅水库下泄、南水北调中线来水、下游再生水。
- 合成控制断面：三家店、卢沟桥、屈家店及场景内的翠之汇营控制点。
- 任务：在当前已经释放的 Observation 范围内，提交 24 小时联合调度方案；方案必须满足合成水源可用量、通道能力、传播时滞、生态目标和证据可见性约束。
- 时间线：第一阶段提交初始方案；推进后释放合成来水修订与控制断面观测；第二阶段提交修订方案并获取确定性反馈。

## 推荐工具顺序

1. \`excon_start_episode\`
2. \`excon_observe\`
3. \`excon_submit_allocation_plan\`
4. \`excon_get_feedback\`
5. 得到允许推进的反馈后调用 \`excon_advance\`

---

# Jing-Jin-Ji Yongding River ecological replenishment and multi-source allocation

## Usage boundary

This is a fact-anchored synthetic exercise. The water-system topology and source categories use the Jing-Jin-Ji Yongding River as context. Volumes, flows, thresholds, constraints, observations, and outcomes are fixed synthetic data marked \`simulation-only\`. The exercise is not connected to a live control system and must not be treated as operational advice.

## Decision scope

- Sources: Guanting Reservoir release, South-to-North Water Diversion supply, and downstream reclaimed water.
- Synthetic control sections: Sanjiadian, Lugouqiao, Qujiadian, and the scenario's Cuizhihuiying control point.
- Task: submit a 24-hour joint allocation plan using only released Observations. The plan must satisfy synthetic availability, conveyance capacity, travel-time, ecological-target, and evidence-visibility constraints.
- Timeline: submit an initial plan in stage one; advance to receive a synthetic inflow revision and control-section observation; submit a revised plan in stage two and retrieve deterministic feedback.

## Recommended tool sequence

1. \`excon_start_episode\`
2. \`excon_observe\`
3. \`excon_submit_allocation_plan\`
4. \`excon_get_feedback\`
5. Call \`excon_advance\` only after feedback permits advancement.
`;
