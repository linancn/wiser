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

## 决策任务

参训智能体需要在分阶段信息下，提出未来 24 小时的联合调度方案：

1. 为每个合成水源分配分时段供水量；
2. 给出官厅水库下泄和下游补水组合；
3. 满足合成控制断面的生态流量与水质约束；
4. 遵守水源可用量、工程能力、传播时滞和总量平衡；
5. 在新的来水、监测或约束 Inject 到达后修订方案；
6. 引用当时已经成为 Observation 的证据。

目标不是求一个现实“最优解”，而是验证智能体能否在可见信息和约束内形成可解释、可复算的方案。

## 合成数据包

首切片使用一份小型、固定、可提交仓库的 fixture：

- `facts/official-anchors.json`：少量官方事实及来源 ID；
- `fixture/stage-1.json`：三个水源上限、四个断面目标、传递模型和可行方案；
- `fixture/stage-2.json`：第二阶段完整约束更新和最终方案；
- `outcome`：演练结束后揭示的合成结果。

HTTP Observation 同时保留 `eventTime`、`observedTime`、`ingestedTime`、`releasedTime`、墙钟 `accessedTime` 和演练时钟 `accessedVirtualTime`。证据资格以释放、虚拟访问时点、Episode 所有权和可选 `supersedesInformationId` 为准。

## 演练时间线

```text
2023-03-22 15:00 CST  锁定版本，释放第一阶段事实锚点与完整合成规则
                         智能体 Observe、提交 stage 1 方案并获取确定性 Feedback
                         未通过时创建 revisionNo 递增的不可变修订
2023-03-23 11:10 CST  推进检查点，释放带 supersedesInformationId 的完整规则更新
                         智能体重新 Observe，提交 stage 2 最终方案并完成 Episode
```

修订不会覆盖首次提交。新 Submission 通过 `revisionNo` 和 `revisionOf` 指向前一版本，从而保留反馈前后的能力变化。

## 提交最小结构

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

上例只展示 envelope 中的单项；实际契约要求三个水源和四个断面。数值单位为合成模型中的 m³/s，带 `simulationOnly` 安全边界，不构成现实流量指令。

## 确定性裁决

第一版依次验证：

1. Schema、单位和数值范围；
2. Episode 状态与提交权限；
3. 引用证据是否已向该参与者释放；
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
- Event 流可重建 Episode 状态和每个时点的可见数据集。
- 固定场景版本与随机种子得到完全相同的合成 Outcome 和评分。
