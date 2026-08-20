---
title: 京津冀永定河生态补水与多水源联合调度
description: 以真实水系统和水源关系为锚点、使用合成运行数据的首个可复现演练。
---

## 案例性质

这是一个**事实锚定的合成演练**，不是对某一现实年度调度过程的复刻，也不用于给出现实水量调度建议。

- **事实锚点**：永定河跨区域水系统、水源类型、关键工程，以及 2023-03-22/23 少量带来源的官方断面流量。
- **合成内容**：水源能力、传递系数、生态目标、约束更新、调度方案、评分和最终 Outcome。
- **隔离要求**：所有合成记录标记 `simulationOnly: true`，不得与现实业务库或实时控制系统连接。

## 事实锚点

权威公开资料表明，永定河生态补水采用跨区域、多水源统一调度：官厅水库以上可统筹册田、友谊、洋河等水库及引黄工程；官厅水库以下可统筹官厅水库、小红门再生水和南水北调中线引江水。现实调度会跟踪补水流量过程并动态优化，涉及官厅水库、三家店、卢沟桥等关键位置。

现实永定河流域还涉及内蒙古、山西等上游区域。本演练把决策域限定在京津冀水系统，把晋蒙上游来水作为带来源和时态的边界输入，不虚构跨行政区指挥权。

- [北京市水务局：2023 年永定河生态补水](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/202303/t20230320_2940003.html)
- [北京市水务局：2023 年 3 月 22 日补水每日信息](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230322_2942113.html)
- [北京市水务局：2023 年 3 月 23 日补水每日信息](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230323_2942886.html)
- [北京市水务局：水利部调水管理司调研永定河生态补水工作](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202312/t20231201_3330949.html)

官方流量只作为历史时点 Observation；它不直接给出智能体应选择的调度值。仓库不复制网页、图片或完整监测序列，来源与许可边界见场景目录的 `PROVENANCE.md`。

## 团队决策任务

v2 由多个参训智能体在分阶段、差异化信息下，共同提出未来 24 小时的联合调度方案：

1. 为每个合成水源分配分时段供水量；
2. 给出官厅水库下泄和下游补水组合；
3. 满足合成控制断面的生态流量与水质约束；
4. 遵守水源可用量、工程能力、传播时滞和总量平衡；
5. 在新的来水、监测或约束 Inject 到达后修订方案；
6. 引用当时已经成为 Observation 的证据。

目标不是求一个现实“最优解”，而是验证智能体团队能否在各自可见信息和约束内，通过显式协作形成可解释、可复算的方案。

## 多智能体编组

| 角色             | 主要职责                               | 显式交付物           |
| ---------------- | -------------------------------------- | -------------------- |
| 水情与证据智能体 | 核对来源、时态、修订链和来水信息       | 证据清单与来水摘要   |
| 水动力约束智能体 | 计算输水损失、断面响应和容量边界       | 断面约束工件         |
| 生态目标智能体   | 分析目标区间、连续性和风险             | 生态优先级与风险工件 |
| 调度协调智能体   | 汇总已共享工件，形成候选方案和团队修订 | 团队 Submission      |

前三个角色并行工作，在 `analysis-ready` Barrier 汇流后由调度协调角色集成。团队提交必须引用贡献者的 ArtifactVersion 和自身已获得的 Receipt。调度协调角色不能读取其他智能体未显式共享的内部上下文。

## 合成数据包

首切片使用一份小型、固定、可提交仓库的 fixture：

- `facts/official-anchors.json`：少量官方事实及来源 ID；
- `fixture/stage-1.json`：三个水源上限、四个断面目标、传递模型和可行方案；
- `fixture/stage-2.json`：第二阶段完整约束更新和最终方案；
- `outcome`：演练结束后揭示的合成结果。

HTTP Observation 同时保留 `eventTime`、`observedTime`、`ingestedTime`、`releasedTime`、墙钟 `accessedTime` 和演练时钟 `accessedVirtualTime`。v2 把实际发给每个 RunAgent 的内容固化为不可变 Receipt；证据资格以 Receipt、虚拟访问时点、RunAgent 身份和可选 `supersedesInformationId` 为准。

## 演练时间线

```text
2023-03-22 15:00 CST  锁定版本，向各角色释放不同的第一阶段 Receipt
                         多个 Agent 并行 Task，发布 Artifact 并在 Barrier 汇流
                         协调 Agent 提交团队方案，个人与团队分别获取 Feedback
2023-03-23 11:10 CST  推进检查点，释放带 supersedesInformationId 的完整规则更新
                         各 Agent 并行修订并形成 stage 2 最终团队方案
```

修订不会覆盖首次提交。新 Submission 通过 `revisionNo` 和 `revisionOf` 指向前一版本，从而保留反馈前后的能力变化。

## v1 兼容提交结构

```json
{
  "stage": 1,
  "sourceReleases": [
    {
      "sourceId": "guanting",
      "flowM3s": 20,
      "evidenceRefs": [
        "official-flow-20230322-guanting",
        "simulated-rules-20230322-stage-1"
      ]
    }
  ],
  "expectedSectionFlows": [{ "sectionId": "sanjiadian", "flowM3s": 18 }],
  "isFinal": false
}
```

上例是现有单智能体 walking slice 的兼容 envelope，只展示其中单项；实际 v1 契约要求三个水源和四个断面。v2 团队 Submission 还会携带 Task、贡献 RunAgent、ArtifactVersion、Receipt 和 endorsement 引用。数值单位属于合成模型，带 `simulationOnly` 安全边界，不构成现实流量指令。

## 确定性裁决

第一版依次验证：

1. Schema、单位和数值范围；
2. RunTask 状态、角色和团队提交权限；
3. 引用证据是否已成为该 RunAgent 的 Receipt；
4. 三个水源上限、总释放上限和 0.1 m³/s 步长；
5. 四段固定传递模型与申报断面流量的 0.01 m³/s 误差；
6. 合成生态断面目标、证据覆盖和时间穿越；
7. 总分与参与者可见 issues。

LLM 不参与基准裁决。模型辅助评价以后可以检查方案解释质量，但不能覆盖确定性约束失败。

## TDD 验收

- T+06 的方案引用 T+12 才释放的来水修订时，返回稳定错误且不泄露修订内容。
- 超过合成水源可用量或通道能力的方案给出可定位的约束错误。
- 相同幂等键只产生一个 Submission 和一个 Event。
- 首轮与修订方案都可查询，并能计算反馈后的改善量。
- RunEvent 与 AgentViewReceipt 可重建 Run 状态及每个 Agent 当时的可见数据集。
- 三个并行分析 Task 不因另一个 Task 进入评价而停止。
- Evaluation 通过 Span Links 引用所有贡献 Trace；删除 Trace 后仍能完成领域回放。
- 固定场景版本与随机种子得到完全相同的合成 Outcome 和评分。
