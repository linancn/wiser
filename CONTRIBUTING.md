# Contributing / 贡献指南

中文为项目默认语言；Issue、PR 和提交信息也可以使用英文。协议字段、错误码和代码标识符使用英文，界面文案通过 locale 字典提供中英文版本。

## TDD 工作流

每项行为变更都应遵循：

1. **Red**：写一个能说明用户行为或领域不变量的失败测试，确认它因预期原因失败。
2. **Green**：实现满足该测试的最小改动，同时保持已有测试通过。
3. **Refactor**：在全绿前提下消除重复、收紧命名和边界。
4. **Verify**：提交前运行 `pnpm verify`；数据库变更还要运行数据库重置和 RLS 测试。

测试应优先验证可观察行为，而不是内部调用次数。生产缺陷必须先由回归测试复现。确定性规则和隐藏 outcome 不得由 LLM mock 代替。

## 提交

使用小而可审计的 Conventional Commit：

```text
test: specify observation visibility boundary
feat: reject evidence that was not observed
refactor: isolate episode transition policy
docs: explain local codex provider boundary
```

允许保留 Red 阶段提交以展示 TDD 轨迹，但发布里程碑与标签必须位于全绿提交。

## 数据与安全

- 只提交具有明确再分发许可的数据，并在场景目录维护 `PROVENANCE.md`。
- 不提交真实密钥、访问令牌、个人数据或 Codex 登录文件。
- `public` schema 的表必须启用 RLS；隐藏事实与裁决数据进入非暴露 schema。
- AI provider 输出必须经过本地 schema 校验，且不能决定确定性评分。
