---
title: 测试与完成定义
description: WISER 的 Red-Green-Refactor 循环、根验证范围、聚焦测试、集成 smoke、AI fake 边界和完成标准。
docType: workflow
scope: repository-testing
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 开始行为变更、选择验证命令或准备提交时
  - 修改数据库、浏览器流程、可观测性或 Agent 演练时
whenToUpdate:
  - 测试脚本、CI 门禁、workspace 或完成定义变化时
checkPaths:
  - package.json
  - vitest.config.ts
  - apps/*/package.json
  - apps/*/vitest.config.ts
  - apps/*/playwright.config.ts
  - scripts/data-foundation/**
  - infrastructure/observability/**
  - examples/agent-excon/**
  - .github/workflows/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Red → Green → Refactor

行为变更从一个描述用户结果、协议保证或领域不变量的失败测试开始。

1. **Red**：写最小失败测试，实际运行并确认失败原因正是缺少目标行为，而不是 fixture、环境或拼写错误。
2. **Green**：实现让该测试通过的最小变化，并运行同一边界的回归测试。
3. **Refactor**：在测试保持全绿时整理命名、重复和依赖方向，不改变外部行为。
4. **Integrate**：根据变化类型运行真实数据库、浏览器、可观测性或纵向 smoke。
5. **Document and commit**：更新中英文文档，运行 Docpact 与最终门禁，保留小而可恢复的 Red/Green 提交。

测试优先调用公开函数、HTTP、GraphQL、MCP、数据库策略或可见 UI。不要用私有函数调用次数代替业务结果；生产缺陷先以回归测试复现。

## 测试层级

| 层级         | 主要证明                                               | 默认工具                           |
| ------------ | ------------------------------------------------------ | ---------------------------------- |
| 纯领域与契约 | 状态转换、评分、Schema、错误码、确定性                 | Vitest                             |
| 应用组件     | Fastify route、身份解析、幂等、adapter 协作            | Vitest + Fastify `inject()`        |
| 数据库集成   | migration、约束、RLS、runtime role、锁与事务原子性     | 本机 Supabase / Compose PostgreSQL |
| 浏览器       | 中文默认、英文同构、深浅色、键盘、响应式和关键流程     | Playwright Chromium                |
| 纵向 smoke   | Auth、API、Worker、持久化、投影、MCP 与 Web 的真实组合 | 仓库运维脚本                       |
| Agent 演练   | 多 RunAgent、Receipt、Barrier、修订与确定性评价        | scripted/rework cookbook           |
| 在线 AI      | 供应商凭据和最小调用可用性                             | 仅显式 opt-in，不进默认测试或 CI   |

## `pnpm verify` 实际覆盖什么

在仓库根目录运行：

```bash
pnpm verify
```

它按顺序执行：

1. `prettier --check .`，检查整个仓库的格式；
2. 生成 Fumadocs 内容后运行 type-aware Oxlint；
3. 对所有声明了 `typecheck` 的 workspace 运行 TypeScript 检查；
4. 根 Vitest 运行 `packages/**/*.spec.ts` 与 `tests/**/*.spec.ts`，随后运行所有 `apps/*` 中存在的 `test` 脚本；
5. 对所有声明了 `build` 的 workspace 构建；
6. 运行 `docker compose config --quiet` 验证默认 Compose 配置。

`pnpm verify` 不会启动 Docker 服务，不会 reset 或测试 Supabase，不会应用 Data migration，不会运行 `data:smoke`，也不包含 Web/Docs Playwright、observability smoke、cookbook、showcase 或任何真实 AI 调用。相关变化必须追加下面的聚焦门禁。

## Vitest 与 workspace 聚焦命令

开发循环先运行最窄命令，再在完成前回到根验证。

| 范围                             | 命令                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| 单个根或 package spec            | `pnpm exec vitest run <path-to-spec>`                                                 |
| Agent EXCON contracts/core/infra | `pnpm exec vitest run packages/contracts/test packages/core/test packages/infra/test` |
| Platform contracts/auth          | `pnpm exec vitest run packages/platform-contracts/test packages/platform-auth/test`   |
| API composition                  | `pnpm --filter @wiser/api test`                                                       |
| Agent EXCON Worker               | `pnpm --filter @agent-excon/worker test`                                              |
| Data Worker                      | `pnpm --filter @wiser/data-worker test`                                               |
| MCP composition                  | `pnpm --filter @wiser/mcp test`                                                       |
| Telemetry Ingress                | `pnpm --filter @wiser/telemetry-ingress test`                                         |
| Web unit/read-model              | `pnpm --filter @wiser/web test`                                                       |
| Data contracts                   | `pnpm --filter @wiser/data-contracts test`                                            |
| Data core                        | `pnpm --filter @wiser/data-core test`                                                 |
| Data infrastructure              | `pnpm --filter @wiser/data-infra test`                                                |
| EXCON scenario assets            | `pnpm --filter @agent-excon/scenarios test`                                           |

`@agent-excon/contracts`、`@agent-excon/core`、`@agent-excon/infra`、`@wiser/platform-contracts` 和 `@wiser/platform-auth` 没有独立 `test` script，它们的 spec 由根 Vitest 配置收集，因此使用表中的路径命令。不要把 `pnpm --filter <package> test` 的无脚本结果误认为测试已经运行。

## Supabase 与 Data Foundation

Supabase schema、RLS、seed 或平台/EXCON 数据库逻辑变化时：

```bash
pnpm supabase:start
pnpm supabase:verify
pnpm supabase:stop
```

`supabase:verify` 会重置本机 Supabase，然后运行 pgTAP、lint 和 advisor。需要保留的数据必须提前备份。

Data package、migration runner 或 Compose 合同变化时先运行：

```bash
pnpm data:verify
```

它不接触运行中的数据库。Data schema、runtime role、Worker、对象存储、投影、REST、GraphQL、MCP 或登录 Web 变化还需要真实纵向路径：

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
pnpm data:down
pnpm supabase:stop
```

在干净环境中，`pnpm stack:full:up` 会执行启动 Supabase、启动 Data profile、migration、seed 和 `data:smoke` 的收敛流程。Smoke 的成功证明 18 个固定步骤跨越上传、扫描、指纹、fake Agent、确定性转换、质量/审核、权威提交、Outbox、五类投影、REST、GraphQL、MCP 和登录 Web，并验证 Outbox 重放不重复创建投影事实。

## Playwright

```bash
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs test:e2e
```

两个 Playwright 配置都会启动自己的开发服务器：Web 使用 `127.0.0.1:3100`，Docs 使用 `127.0.0.1:4321`。这些测试证明浏览器中的路由、语言、主题和交互；除非测试显式连接完整栈，否则它们不能替代统一 Auth 或数据库纵向 smoke。

任何可见 UI 变化都要同时覆盖中文默认与英文等价状态，并检查浅色/深色、键盘焦点、窄屏和失败/不可用状态。修复定位器时优先使用 role、label、可见文本或稳定 test id。

## 可观测性

修改 OTLP ingress、collector、trace/metric/log pipeline、Grafana datasource 或脱敏逻辑时运行：

```bash
pnpm observability:config
pnpm observability:up
pnpm observability:smoke
pnpm observability:down
```

Smoke 检查真实 OTLP traces、metrics、logs 和敏感字段脱敏。它验证的是最佳努力的诊断面；即使 telemetry 完整，也不能替代 Event、Receipt、评价或数据库审计事实。

## Cookbook、showcase 与其他 smoke

Agent EXCON 场景、MCP 参与流程、Barrier、评价或演练 runner 变化时运行两条无模型路径：

```bash
pnpm cookbook:scripted
pnpm cookbook:rework
pnpm showcase:preflight
```

`cookbook:scripted` 验证四个脚本 RunAgent 通过真实 MCP/API 完成案例；`cookbook:rework` 先注入一次 schema 错误，再证明 scoped grant、revision 2 与最终评价。`showcase:preflight` 只验证展示前提，不等于会话已经成功运行。

真实 WorkBuddy 路径会产生模型用量并需要网络、登录和当前用户明确授权：

```bash
WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy
```

它不属于默认验证，也不得因普通代码改动自动运行。完整 Data smoke 使用 `pnpm data:smoke`；可观测性 smoke 使用 `pnpm observability:smoke`。不要把单个 `/health/ready` 响应当作纵向 smoke 通过。

## AI 与确定性边界

- 测试、CI、scripted cookbook 和 Data smoke 使用 fake provider 或确定性 fake embedding，不访问网络且不产生模型费用。
- fake 输出仍要通过与生产 adapter 相同的 Schema 和业务门禁。
- AI 不得生成确定性分数、授权决定、质量结论、验收或发布裁决；这些行为由纯规则和测试固定。
- 本机 Codex provider 只允许在可信宿主显式启用；认证文件不能进入容器。
- OpenAI-compatible 或 WorkBuddy 在线 smoke 必须是显式 opt-in，失败要如实报告，不能隐藏重试或回退为“成功”。

## 何时运行什么

| 变化类型                       | 最小开发循环                       | 合并前追加                                       |
| ------------------------------ | ---------------------------------- | ------------------------------------------------ |
| Contracts / core               | 单个 spec 或 package 路径          | `pnpm verify`                                    |
| API / Worker / MCP             | 对应 workspace `test`              | `pnpm verify`；涉及真实存储时追加相应 smoke      |
| Web / Docs UI                  | Web unit 或 Docs build             | 对应 Playwright + `pnpm verify`                  |
| Supabase schema/RLS/seed       | pgTAP Red + `pnpm supabase:verify` | `pnpm verify`                                    |
| Data schema/runtime/projection | 聚焦 spec + `pnpm data:verify`     | 完整 Data 顺序或 `stack:full:up` + `pnpm verify` |
| Observability                  | 聚焦 Vitest                        | config/up/smoke/down + `pnpm verify`             |
| EXCON 场景/cookbook            | 聚焦 root spec                     | scripted + rework + `pnpm verify`                |
| 文档治理                       | Docs build + `pnpm docpact:check`  | Docs Playwright + `pnpm verify`                  |

## 完成定义

一项变化可以交接之前，应满足：

- 新测试曾因预期原因失败，现在通过；现有回归保持全绿。
- 权限、输入错误、并发、幂等和不可用状态有与风险相称的负向测试。
- Core 保持纯确定性，跨系统调用只经过公开 contracts 或 HTTP。
- 数据库 migration 可从空本机数据库重放；RLS 使用非超级用户实际验证，seed 与声明 schema 保持同步。
- 可见 UI 同步中英文文案，并验证主题、键盘和响应式行为。
- 默认测试没有真实模型调用、外部费用或秘密依赖。
- 编码后运行 `pnpm docpact:check`，更新命中的权威文档或记录真实审查证据。
- 所需聚焦门禁、集成 smoke 和最终 `pnpm verify` 均通过。
- Git diff 只包含预期范围，`git diff --check` 通过；Red 是可恢复检查点，最终提交处于 Green 且目的单一。
