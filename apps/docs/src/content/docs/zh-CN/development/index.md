---
title: 开发手册
description: 选择 WISER 开发路径，并快速定位前端、后端、数据库、测试与文档入口。
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 准备修改 WISER 代码或文档时
whenToUpdate:
  - 仓库结构、开发命令或交付流程变化时
checkPaths:
  - apps/**
  - packages/**
  - infrastructure/**
  - supabase/**
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

## 先选择工作类型

| 要做的事                  | 从哪里开始                            | 首要验证                            |
| ------------------------- | ------------------------------------- | ----------------------------------- |
| 修改产品页面              | `apps/web`                            | `pnpm --filter @wiser/web test`     |
| 修改文档站                | `apps/docs`                           | `pnpm --filter @wiser/docs build`   |
| 修改 HTTP/GraphQL         | `apps/api`                            | `pnpm --filter @wiser/api test`     |
| 修改 Agent EXCON 领域规则 | `packages/contracts`、`packages/core` | 根目录聚焦 Vitest + API/Worker 测试 |
| 修改 Data Foundation      | `packages/data-*`、`apps/data-worker` | `pnpm data:verify`                  |
| 修改 Supabase Auth/控制面 | `supabase`、`packages/platform-*`     | `pnpm supabase:verify`              |
| 修改 MCP                  | `apps/mcp`                            | `pnpm --filter @wiser/mcp test`     |

## 共同约束

- 先运行 `pnpm docpact:route --paths '<实际路径>'` 并阅读返回的权威文档。
- 行为改动使用 Red → Green → Refactor；Red 和 Green 都保留为小提交。
- 纯 `core` 不依赖数据库、HTTP、框架、时钟、随机、文件系统或 AI provider。
- 系统之间只通过公开 contracts 或 HTTP 协作。
- 所有产品界面保持中英文同构、中文默认、深浅色主题、键盘可达和响应式。
- 提交前运行 `pnpm verify`；数据库和浏览器改动追加对应集成测试。

完整本机模式、端口和环境变量见[本机开发环境](/development/local-environment/)。提交与文档治理规则见仓库 `CONTRIBUTING.md`。
