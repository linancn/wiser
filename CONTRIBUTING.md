---
title: WISER contribution guide
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - before preparing a change or pull request
  - when choosing tests and review evidence
whenToUpdate:
  - when contribution, testing, or review policy changes
checkPaths:
  - CONTRIBUTING.md
  - AGENTS.md
  - .docpact/config.yaml
  - .github/workflows/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ac1aa1c902828b69d121b0b0cb3edc9a4058b3e6
---

# Contributing / 贡献指南

中文为项目默认语言；Issue、PR 和提交信息也可以使用英文。协议字段、错误码和代码标识符使用英文，界面文案通过 locale 字典提供中英文版本。

## TDD 工作流

每项行为变更都应遵循：

1. **Red**：写一个能说明用户行为或领域不变量的失败测试，确认它因预期原因失败。
2. **Green**：实现满足该测试的最小改动，同时保持已有测试通过。
3. **Refactor**：在全绿前提下消除重复、收紧命名和边界。
4. **Docs**：编码前使用实际路径或 glob 运行 `pnpm docpact:route --paths 'packages/core/src/**'`；编码后运行 `pnpm docpact:check`，更新或显式审查命中的文档。
5. **Verify**：提交前运行 `pnpm verify`；数据库变更还要运行数据库重置和 RLS 测试。

测试应优先验证可观察行为，而不是内部调用次数。生产缺陷必须先由回归测试复现。确定性规则和隐藏 outcome 不得由 LLM mock 代替。

Docpact 需要本机安装 `docpact` 0.1.9（`cargo install docpact --version 0.1.9`）。规则位于 `.docpact/config.yaml`；规则或 CI 变更还应运行 `pnpm docpact:validate`。Baseline 和 waiver 只用于明确的阶段性债务或临时例外，不作为常规跳过手段。

## 提交

使用小而可审计的 Conventional Commit：

```text
test: specify observation visibility boundary
feat: reject evidence that was not observed
refactor: isolate episode transition policy
docs: explain local codex provider boundary
```

Red commits are recoverable checkpoints / Red 提交是可恢复检查点。允许保留 Red 阶段提交以展示 TDD 轨迹，但必须在提交正文写明预期失败原因；每个里程碑和可交接状态必须位于全绿提交。

大型重构仍使用小而单一目的的提交。依赖、数据库迁移、基础设施、UI 和文档不要混进一个巨型提交。提交前显式暂存当前切片，检查 `git status --short`、`git diff --check` 和 staged diff；除非维护者明确要求，不改写已经用于恢复的提交历史。

## 依赖、容器与产品界面

- 新增或升级 npm 包前查询当前最新兼容稳定版本，排除 alpha、beta、RC、canary 和 preview。使用精确版本并同时提交根 lockfile。
- 容器使用当前最新兼容稳定 tag 与镜像 digest，禁止 `latest`；升级后必须实际运行配置、健康检查和相关 smoke。
- Agent EXCON 与所有新系统共享 WISER Design System、中文默认/英文同构、浅色/深色主题、响应式和键盘可访问性。新增可见文案和页面必须同时提供两个 locale，并通过相应 Playwright 覆盖。

## 数据与安全

- 只提交具有明确再分发许可的数据，并在场景目录维护 `PROVENANCE.md`。
- 不提交真实密钥、访问令牌、个人数据或 Codex 登录文件。
- `public` schema 的表必须启用 RLS；隐藏事实与裁决数据进入非暴露 schema。
- AI provider 输出必须经过本地 schema 校验，且不能决定确定性评分。
