---
title: 京津冀永定河生态补水与多水源联合调度
description: 以真实水系统关系为锚点、使用隔离合成运行数据的可复现多智能体演练。
docType: scenario-guide
scope: jjj-yongding-replenishment-2023
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 使用或修改永定河多水源联合调度场景时
whenToUpdate:
  - 场景事实、合成 fixture、评价规则或来源变化时
checkPaths:
  - packages/excon-scenarios/scenarios/jjj-yongding-replenishment-2023/**
  - skills/agent-excon/references/yongding-allocation.md
lastReviewedAt: 2026-08-22
lastReviewedCommit: ed36c7913b5dd2b2542adf1aa1ce1e5d9a70029f
---

## 案例性质

这是一个**事实锚定的合成演练**，不是对某一现实年度调度过程的复刻，也不能用于给出现实水量调度建议。

- **事实锚点**：永定河跨区域水系统、水源类型、关键工程，以及 2023-03-22/23 少量带来源的官方断面流量。
- **合成内容**：水源能力、传递系数、生态目标、约束更新、调度方案、评分和 Outcome。
- **隔离要求**：所有合成记录标记 `simulationOnly: true`，不得与现实业务库或实时控制系统连接。

## 事实锚点

权威公开资料表明，永定河生态补水采用跨区域、多水源统一调度：官厅水库以上可统筹册田、友谊、洋河等水库及引黄工程；官厅水库以下可统筹官厅水库、小红门再生水和南水北调中线引江水。现实调度会跟踪补水流量过程并动态优化，涉及官厅水库、三家店、卢沟桥等关键位置。

现实流域还涉及内蒙古、山西等上游区域。本演练把决策域限定在京津冀水系统，把晋蒙上游来水作为带来源和时态的边界输入，不虚构跨行政区指挥权。

- [北京市水务局：2023 年永定河生态补水](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/202303/t20230320_2940003.html)
- [北京市水务局：2023 年 3 月 22 日补水每日信息](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230322_2942113.html)
- [北京市水务局：2023 年 3 月 23 日补水每日信息](https://swj.beijing.gov.cn/swdt/ztzl/2023nydhstbsdt/2023bsmrxx/202303/t20230323_2942886.html)
- [北京市水务局：水利部调水管理司调研永定河生态补水工作](https://swj.beijing.gov.cn/swdt/ztzl/hczzl/zydt/202312/t20231201_3330949.html)

官方流量只是带来源的历史锚点，不直接给出参训团队应选择的调度值。仓库不复制网页、图片或完整监测序列；来源与许可边界见场景目录 `PROVENANCE.md`。

## 团队决策任务

多个 RunAgent 在分阶段、差异化信息下共同提出未来 24 小时的联合调度方案：

1. 为每个合成水源分配分时段供水量；
2. 给出官厅水库下泄和下游补水组合；
3. 满足合成控制断面的生态流量与水质约束；
4. 遵守水源可用量、工程能力、传播时滞和总量平衡；
5. 在新的来水、监测或约束 Inject 到达后修订方案；
6. 只引用已通过 `/sync` 发放并形成自身 `AgentViewReceipt` 的信息，或显式授权的 ArtifactVersion。

目标不是求现实“最优解”，而是验证团队能否在各自可见信息和约束内，通过显式协作形成可解释、可复算的方案。

## 多智能体编组

| 角色             | 主要职责                               | 显式交付物           |
| ---------------- | -------------------------------------- | -------------------- |
| 水情与证据智能体 | 核对来源、时态、修订链和来水信息       | 证据清单与来水摘要   |
| 水动力约束智能体 | 计算输水损失、断面响应和容量边界       | 断面约束工件         |
| 生态目标智能体   | 分析目标区间、连续性和风险             | 生态优先级与风险工件 |
| 调度协调智能体   | 汇总已共享工件，形成候选方案和团队修订 | 团队 Submission      |

前三个角色并行工作，在 `analysis-ready` Barrier 汇流后由调度协调角色集成。团队 Submission 必须引用贡献者的 ArtifactVersion 和协调 RunAgent 自身已经获得的 Receipt；协调角色不能读取其他 RunAgent 未显式共享的上下文。

## 合成数据包

运行时包把来源锚点、阶段规则与测试 fixture 分开：

- `facts/official-anchors.json`：少量官方事实及来源 ID；
- `fixture/stage-1.json`：三个合成水源上限、四个断面目标、传递模型和可行方案；
- `fixture/stage-2.json`：后续约束更新和最终方案；
- `v2/case-pack.json`：发布给运行时的版本化多角色场景蓝图；
- `provenance/sources.yaml` 与 `PROVENANCE.md`：来源、混合许可和隔离说明。

v2 以 `/sync` 固化每个 RunAgent 实际收到的信息与 Receipt chain。事实资格由 Receipt、RunAgent、发放时的虚拟时点与修订关系共同决定。

## 演练时间线

```text
2023-03-22 15:00 CST  锁定版本，向各角色发放不同的第一阶段 Receipt
                         多个 RunAgent 并行 Task，发布 Artifact 并在 Barrier 汇流
                         协调角色提交团队方案，个人与团队分别获得 Feedback
2023-03-23 11:10 CST  发放带 supersedesInformationId 的规则更新
                         各角色并行修订并形成第二阶段团队方案
```

修订不会覆盖首次提交。新 Submission 使用 `revisionNo` 和 `revisionOf` 指向前一版本，从而保留反馈前后的变化。

## v1 兼容提交

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

该 envelope 只属于显式 v1 单 Agent compatibility，示例只展示一项；实际 v1 契约要求三个水源和四个断面。v1 Observation DTO 保留 `eventTime`、`observedTime`、`ingestedTime`、`releasedTime`、`accessedTime`、`accessedVirtualTime` 与可选 `supersedesInformationId`。不要把这些 v1 字段当成 v2 Receipt 协议。

v2 团队 Submission 还引用 Task、贡献 RunAgent、ArtifactVersion、Receipt 和 endorsement。`flowM3s` 数值使用合成 m³/s 模型并带 `simulationOnly` 边界，不构成现实流量指令。

## 确定性裁决

评价器验证 Schema、Task/角色/团队权限、Receipt/ArtifactVersion 证据资格、三个合成水源上限、总释放上限、0.1 m³/s 步长、四段固定传递模型、0.01 m³/s 申报误差、生态目标、证据覆盖和时间穿越。

LLM 不参与确定性评分。可选模型解释即使通过 schema，也不能覆盖任何确定性约束失败、授权失败或最终 verdict。

## TDD 验收

- T+06 方案引用 T+12 才发放的来水修订时，返回稳定错误且不泄露修订内容。
- 超过合成水源可用量或通道能力的方案给出可定位的约束错误。
- 相同幂等键只产生一个 Submission 和一个 Event。
- 首轮与修订方案都可查询，并能计算反馈后的改善量。
- RunEvent 与 AgentViewReceipt 可重建 Run 状态及每个 RunAgent 当时的可见数据集。
- 三个并行分析 Task 不因另一个 Task 进入评价而停止。
- Evaluation 通过 Span Links 引用贡献 Trace；删除 Trace 后仍能完成领域回放。
- 固定场景版本与随机种子得到完全相同的合成 Outcome 和评分。
