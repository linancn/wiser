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
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

## 开始前

从仓库根目录启用 Corepack 并安装冻结依赖；Node/pnpm/Docker 的支持范围以根 `package.json` 和[快速开始](/quick-start/)为准：

```bash
corepack enable
pnpm install --frozen-lockfile
```

随后对实际目标路径运行 Docpact route，再创建或修改文件。

## 先选择工作类型

| 要做的事                  | 从哪里开始                                                              | 首要验证                            |
| ------------------------- | ----------------------------------------------------------------------- | ----------------------------------- |
| 修改产品页面              | `apps/web`                                                              | `pnpm --filter @wiser/web test`     |
| 修改文档站                | `apps/docs`                                                             | `pnpm --filter @wiser/docs build`   |
| 修改 HTTP/GraphQL         | `apps/api`                                                              | `pnpm --filter @wiser/api test`     |
| 修改 Agent EXCON 领域规则 | `packages/contracts`、`packages/core`                                   | 根目录聚焦 Vitest + API/Worker 测试 |
| 修改 Data Foundation      | `packages/data-*`、`apps/data-worker`、`infrastructure/data-foundation` | `pnpm data:verify`                  |
| 修改 Supabase Auth/控制面 | `supabase`、`packages/platform-*`                                       | `pnpm supabase:verify`              |
| 修改 MCP                  | `apps/mcp`                                                              | `pnpm --filter @wiser/mcp test`     |

## 指南目录

| 页面                                                     | 解决的问题                                                        |
| -------------------------------------------------------- | ----------------------------------------------------------------- |
| [仓库结构与依赖边界](/development/repository-structure/) | 代码、运行时资产、示例和测试应该放在哪里？                        |
| [本机开发环境](/development/local-environment/)          | 应选完整栈、基础栈还是单应用？端口、身份与停止方式是什么？        |
| [后端开发](/development/backend/)                        | API、两个 Worker、MCP 与 Telemetry Ingress 如何运行和验证？       |
| [前端开发](/development/frontend/)                       | Web 与 Docs 的路由、Session、双语、主题和 Playwright 合同是什么？ |
| [产品界面与内容设计](/development/product-experience/)   | Portal、导航层级、产品命名、用户文案和失败态应该如何设计？        |
| [数据库与迁移](/development/databases/)                  | Supabase 与 data-postgres 的权威、迁移、RLS 和 reset 如何区分？   |
| [测试与验证](/development/testing/)                      | 一项改动应运行哪些 Red/Green、聚焦、数据库、浏览器与 smoke 门禁？ |
| [文档开发](/development/documentation/)                  | README、文档站、组件说明、双语与 Docpact 如何维护？               |
| [新增 WISER 系统](/development/adding-a-system/)         | 如何把第三个业务系统接入共享 Auth、宿主、UI、文档和 CI？          |

## 共同约束

- 先运行 `pnpm docpact:route --paths '<实际路径>'` 并阅读返回的权威文档。
- 行为改动使用 Red → Green → Refactor；Red 和 Green 都保留为小提交。
- 纯 `core` 不依赖数据库、HTTP、框架、时钟、随机、文件系统或 AI provider。
- 系统之间只通过公开 contracts 或 HTTP 协作。
- 所有产品界面保持中英文同构、中文默认、深浅色主题、键盘可达和响应式。
- 提交前运行 `pnpm verify`；数据库和浏览器改动追加对应集成测试。

提交规则见仓库 `CONTRIBUTING.md`；面向 Agent 的不可变交付合同见根 `AGENTS.md`。
