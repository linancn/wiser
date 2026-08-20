# 故障注入与 Red → Green

## 已发布故障：`water-evidence-schema-once`

运行：

```bash
pnpm cookbook:rework
```

这条路径只在 scripted profile 生效：

1. `water-evidence` 首次提交缺少必填字段且 `evidenceRegister` 为空。
2. 确定性 evaluator 产生 `REWORK_REQUIRED`，并给该 RunAgent 一次 scoped `resubmit` grant。
3. 原 Artifact 追加不可变修正版；原 Submission 保留为 revision 1。
4. 同一智能体重新 claim/begin，携带 `revisionOfId` 与 `feedbackActionGrantId` 提交 revision 2。
5. revision 2 得到 `ACCEPTED`；三个专业角色全部 Green 后才释放 `analysis-ready`。

`cookbook-report.json.tddCycle` 必须显示：

```json
{
  "injectedFault": "water-evidence-schema-once",
  "reworkObserved": true,
  "greenAccepted": true
}
```

同时，水情角色的评价序列必须是 `REWORK_REQUIRED` → `ACCEPTED`，而不是覆盖第一次结果、修改 evaluator 或由 runner 直接释放 Barrier。

## 安全停止

- 没有 scoped grant、grant 已过期/撤销/耗尽：停止，不猜测。
- lease 丢失或 fencing 失败：停止写入，先用自身视角恢复。
- Receipt hash/sequence 不连续：停止并报告完整性错误。
- 真实 WorkBuddy 运行不接受自动故障注入；如模型自然进入返工，仍必须走相同的 immutable successor 路径。
- 任一失败都要清理凭据；不得为了“让测试过”使用 operator token、修改数据库或伪造 Event。
