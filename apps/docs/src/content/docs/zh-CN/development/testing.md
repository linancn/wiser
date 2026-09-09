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
  - apps/*/playwright.*.config.ts
  - apps/*/e2e*/**
  - scripts/data-foundation/**
  - infrastructure/observability/**
  - examples/agent-excon/**
  - .github/workflows/**
lastReviewedAt: 2026-08-23
lastReviewedCommit: 009852bdcfd26240fa31553e7d0e2254400aaf67
---

## Red → Green → Refactor

行为变更从一个描述用户结果、协议保证或领域不变量的失败测试开始。

1. **Red**：写最小失败测试，实际运行并确认失败原因正是缺少目标行为，而不是 fixture、环境或拼写错误。
2. **Green**：实现让该测试通过的最小变化，并运行同一边界的回归测试。
3. **Refactor**：在测试保持全绿时整理命名、重复和依赖方向，不改变外部行为。
4. **Integrate**：根据变化类型运行真实数据库、浏览器、可观测性或纵向 smoke。
5. **Document and commit**：更新中英文文档；每个提交前运行 worktree Docpact check，分支交接前再对 merge base 运行 branch-wide lint；保留小而可恢复的 Red/Green 提交。

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
4. `pnpm test:coverage` 在一次 Vitest projects 运行中执行完整单元测试并检查覆盖率：各 app project 可并行执行，名为 `repository` 的根 project 串行运行 `packages/**/*.spec.ts` 与 `tests/**/*.spec.ts`；
5. `pnpm test:ops` 用 Node test runner 运行 `scripts/data-foundation/*.test.mjs`，验证运维编排、runtime role、Supabase 状态解析和纵向 smoke 合同；
6. 对所有声明了 `build` 的 workspace 构建；
7. 运行 `docker compose config --quiet` 验证默认 Compose 配置。

`pnpm verify` 不会启动 Docker 服务，不会 reset 或测试 Supabase，不会应用 Data migration，不会运行 `data:smoke`，也不包含 Web/Docs Playwright、observability smoke、cookbook、showcase 或任何真实 AI 调用。相关变化必须追加下面的聚焦门禁。

## CI 调度与完成判定

文档治理、workspace 验证、reference 浏览器、Supabase、Data Foundation 和可观测性在隔离 runner 上独立启动，不消费 workspace 作业的构建产物。交付合同仍要求每项现有检查通过；`CI complete` 等待全部六个作业，并拒绝失败、取消、跳过或缺失结果。配置分支保护时保留现有必需检查名称；汇总检查是追加检查，不能用来省略任何验证作业。

push 前运行 `pnpm verify`，本地便会执行与 CI 相同的单元覆盖率棘轮。集成数据库继续使用可丢弃状态并从迁移创建；各集成作业内保留环境准备、断言和无条件清理顺序。并行调度只改变开始时间，不改变通过条件。

### CI 镜像与环境准备

CI 使用固定版本的 Buildx/BuildKit，从当前 checkout 构建并加载共享应用及隔离解析器镜像。BuildKit 的 GitHub Actions v2 缓存只保存镜像层，应用按作业使用独立 scope，解析器使用自己的 scope。缓存导出最多等待两分钟，导出失败不改变测试结果；缓存未命中仍执行完整构建。运行凭据、数据库卷和 smoke 状态不进入缓存，也不上传 build record。

应用 Dockerfile 先复制根 package manifest（含 pnpm 版本）、workspace 配置和 lockfile，再执行 `pnpm fetch`；随后复制源码，用 `pnpm install --offline --frozen-lockfile` 校验全部 workspace manifest。仅修改源码时可复用依赖下载，同时保留冻结依赖图检查。

镜像加载后，`scripts/data-foundation/prepare-ci.mjs` 先校验合并后的 Compose 配置，再并行执行 `supabase:start → supabase:reset` 与缺失远程镜像拉取。该入口只允许可丢弃的 GitHub-hosted runner，等待两个分支都结束，任一失败都会阻止运行时启动。CI 随后使用 `pnpm data:up --no-build`；迁移、seed、服务健康、解析器、smoke、登录浏览器和 PostgreSQL 检查仍全部运行。本机普通 `pnpm data:up` 继续构建镜像并加载本机 Compose override。

## Vitest 与 workspace 聚焦命令

开发循环先运行最窄命令，再在完成前回到根验证。

| 范围                             | 命令                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| 单个根或 package spec            | `pnpm exec vitest run <path-to-spec>`                                                 |
| 全部 unit coverage               | `pnpm test:coverage`                                                                  |
| Data Foundation 运维合同         | `pnpm test:ops`                                                                       |
| Agent EXCON contracts/core/infra | `pnpm exec vitest run packages/contracts/test packages/core/test packages/infra/test` |
| Platform contracts/auth          | `pnpm exec vitest run packages/platform-contracts/test packages/platform-auth/test`   |
| API composition                  | `pnpm --filter @wiser/api test`                                                       |
| Agent EXCON 持久 journal         | `pnpm test:postgres:excon-v2`                                                         |
| EXCON v1 compatibility Worker    | `pnpm --filter @agent-excon/worker test`                                              |
| Data Worker                      | `pnpm --filter @wiser/data-worker test`                                               |
| MCP composition                  | `pnpm --filter @wiser/mcp test`                                                       |
| Telemetry Ingress                | `pnpm --filter @wiser/telemetry-ingress test`                                         |
| Web unit/read-model              | `pnpm --filter @wiser/web test`                                                       |
| Data contracts                   | `pnpm --filter @wiser/data-contracts test`                                            |
| Data core                        | `pnpm --filter @wiser/data-core test`                                                 |
| Data infrastructure              | `pnpm --filter @wiser/data-infra test`                                                |
| EXCON scenario assets            | `pnpm --filter @agent-excon/scenarios test`                                           |

`pnpm test` 明确组合 `test:unit` 与 `test:ops`。`@agent-excon/contracts`、`@agent-excon/core`、`@agent-excon/infra`、`@wiser/platform-contracts` 和 `@wiser/platform-auth` 没有独立 `test` script，它们的 spec 由 `repository` project 收集，因此使用表中的路径命令。不要把 `pnpm --filter <package> test` 的无脚本结果误认为测试已经运行。

## 覆盖率

```bash
pnpm test:coverage
```

该命令在同一次 Vitest projects 运行中合并 packages 与具有 unit suite 的 apps，显式纳入尚未被测试 import 的 TypeScript/TSX 源文件，并生成文本、`coverage/lcov.info` 与 `coverage/coverage-summary.json`。Docs 仍由 build/Playwright 验证，不进入 unit coverage。长运行进程的 bootstrap 文件显式排除；CLI、barrel 和 Web 页面保留在报告中。

经过实测的覆盖率棘轮设置全局下限：statement 73%、branch 67%、function 75%、line 76%。纯 Core v2、共享确定性 helper、OTLP Collector forwarder，以及 Graph/STAC/PostGIS 输入校验使用更高的分层下限。本地和 CI 的 `pnpm verify` 都恰好运行一次该命令；CI 保留 LCOV 与 JSON summary 7 天。阈值禁止自动更新；后续上调必须基于新的 Green 报告显式评审。

这些数字只衡量 Vitest manifest。Playwright、pgTAP、真实 PostgreSQL integration、运维 smoke 与浏览器可见的 Next.js 页面仍是独立证明层，不会合并进 unit 百分比。不得为了容纳未测试代码而下调阈值，也不能把全局数字解释成产品级覆盖率。

## Supabase 与 Data Foundation

Supabase schema、RLS、seed 或平台/EXCON 数据库逻辑变化时：

```bash
pnpm supabase:start
pnpm supabase:verify
pnpm supabase:stop
```

`supabase:verify` 会重置本机 Supabase，然后运行 pgTAP、lint 和 advisor。需要保留的数据必须提前备份。

Agent EXCON journal 深度测试只允许连接已经验证的本机 Supabase PostgreSQL，并要求显式提供 loopback 管理员 URL：

```bash
EXCON_JOURNAL_TEST_ADMIN_URL='<loopback-admin-dsn>' pnpm test:postgres:excon-v2
```

该套件不会 reset 共享的 `postgres` 数据库。七个串行用例分别创建一个精确跟踪的临时数据库和 login role，应用 canonical journal migration，经过生产 runtime 后关闭所有 service/pool，并只删除自己记录的对象。它验证最小权限下的重启/回放、pending outcome 恢复、唯一 writer、result drift、intent corruption、历史 HMAC key 丢失，以及拒绝具备 RLS bypass、创建数据库/角色或 replication 能力的 runtime role。CI 在 `supabase:verify` 之后、无条件停止 Supabase 之前运行它。

Data package、migration runner 或 Compose 合同变化时先运行：

```bash
pnpm data:verify
```

`data:verify` 复用根 `test:ops` 入口，再检查四个 Data workspace 的 test/typecheck/build 和 Compose 配置；它不接触运行中的数据库。Data schema、runtime role、Worker、对象存储、投影、REST、GraphQL、MCP 或登录 Web 变化还需要真实纵向路径：

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

两个真实 PostgreSQL adapter 门禁只允许指向 CI 或明确可丢弃的隔离 Data 数据库。API 门禁同时运行 command 与 PostGIS query spec，需要 migration owner DSN 来创建临时非 bypass role；Worker 门禁使用真实 `wiser_data_worker` 登录并会提交随机 authority fixture：

```bash
WISER_DATA_PG_INTEGRATION=1 DATA_TEST_DATABASE_URL='<owner-dsn>' pnpm test:postgres:data-api
DATA_WORKER_PG_SMOKE_URL='<worker-dsn>' pnpm test:postgres:data-worker
```

API command spec 通过临时非 bypass role 证明 Operation、Ingestion、Job 与 Transform Plan 的非法转换会以稳定 PostgreSQL 错误失败，并验证权威 identity/content、终态与运行中同态保护、Capability 限定的上传完成、精确 row version、旧 claim 路径移除、审核唤醒后准确的 claim event 历史，以及合法 heartbeat/等待态聚合；其正向 fixture 沿合法生命周期逐步推进，不直接插入不可能的中间状态。API PostGIS spec 另行证明权威的最新/精确不可变版本选择、sibling extent 聚合、snapshot 分页、DataItem 交集，以及 Tenant、安全等级和策略边界全部 fail closed。登录态 GeoJSON 浏览器 fixture 必须启用 vector、禁用 raster，且不发出 raster tile 请求；它验证版本级权威 metadata，但不把 fixture 冒充为有效 COG 证明。随后 Worker 深度测试证明完整 ingestion commit 路径仍可通过受保护 schema。

Data Foundation CI 先完成纵向 smoke 并保存机器可读报告，再对同一套栈运行登录态 Data 浏览器套件，然后运行 API、Worker 两个深度测试，最后无条件删除该 job 的 Data volumes。固定顺序是 `smoke → 登录态浏览器 → API/Worker 深度测试 → always cleanup`；前序任一步失败也必须执行清理。不要把这些命令指向共享数据库或需要保留的本机 volume。

在干净环境中，`pnpm stack:full:up` 会执行启动 Supabase、启动 Data profile、migration、seed 和 `data:smoke` 的收敛流程。Smoke 的成功证明固定步骤跨越上传、扫描、指纹、fake Agent、确定性转换、质量/审核、权威提交、Outbox、五个 completion target、REST、GraphQL、MCP 和登录 Web，并验证 Outbox 重放不重复创建 target facts。上传 bundle 同时包含英文与 `zh-CN` Markdown；REST 阶段会分别限定 `fulltext`、`semantic` 与 `graph` source，证明 OpenSearch 中文多 analyzer、Weaviate 纯向量和 Neo4j 全文图种子都能独立召回同一受控版本。

## Playwright

同时运行两套 reference 浏览器测试：

```bash
pnpm test:e2e:reference
```

也可以只运行受影响的应用：

```bash
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs test:e2e
```

根命令以 workspace concurrency 2 并行运行 Web 与 Docs，并使用 `--no-bail`：任一套件失败都会使命令失败，另一套件仍完成并保留自己的诊断。两者使用不同端口和输出目录。两个 Playwright 配置都会启动自己的隔离开发服务器：Web 使用 `127.0.0.1:3200`，Docs 使用 `127.0.0.1:4322`。Web 在这一隔离套件中显式配置 reference/Auth-off 模式，生产环境继续禁止关闭认证。CI 的 Web 使用一个浏览器 worker，每个测试上限 60 秒，避免并发首次路由编译，并允许多视口导航用例在 runner 上完成；本地 Web 使用四个 worker。CI 的 browser job 独立于 `pnpm verify` 运行同一根命令，只在失败时保留 screenshot、trace 和 HTML report。这些套件证明浏览器中的路由、语言、主题和交互；它不能替代统一 Auth 或数据库纵向 smoke，包含编译的耗时也不作为生产延迟预算。

### 登录态 Data live 套件

一套可丢弃的 loopback 栈已经完成 Data migration、seed 和 smoke 后，对同一套栈运行受保护浏览器流程：

```bash
WISER_WEB_LIVE_BASE_URL='http://127.0.0.1:3100' \
WISER_WEB_LIVE_SMOKE_REPORT='<成功-smoke-report.json-的绝对路径>' \
WISER_WEB_LIVE_EMAIL='<本机-seed-账号>' \
WISER_WEB_LIVE_PASSWORD='<本机-seed-密码>' \
pnpm test:e2e:data-live
```

| 变量                          | 合同                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------- |
| `WISER_WEB_LIVE_BASE_URL`     | 已运行 Web 应用的 loopback origin；禁止指向共享、staging 或 production 环境。 |
| `WISER_WEB_LIVE_SMOKE_REPORT` | 同一套栈刚生成且成功的机器可读 `data:smoke` 报告绝对路径。                    |
| `WISER_WEB_LIVE_EMAIL`        | 通过登录界面使用的本机 seed fixture 身份。                                    |
| `WISER_WEB_LIVE_PASSWORD`     | 该本机 fixture 身份的密码；不得打印，也不得持久化进诊断产物。                 |

这个命令只消费既有测试栈，不负责编排：它不会启动或停止服务，不会应用 migration 或 seed，不会运行 smoke，也不会 reset 任何权威存储。它必须复用已经 migrate、seed、smoke 验证过的 loopback 可丢弃栈，且该栈的数据和 volumes 都允许清理。与 reference/Auth-off 套件不同，它通过真实 Supabase Session 登录并验证受保护的 Data Web/API 行为；reference 套件通过不能替代这条身份边界。

Live Playwright 配置关闭 trace 和 video，只在失败时截图。CI 只允许上传失败运行的 screenshot 与 live HTML report，并设置受限访问和短保留期；不得发布四个环境变量、Auth cookie 或 storage state、请求头、DSN、smoke 报告、服务日志或下载的用户内容。即使是允许保留的失败诊断，向 CI 之外分享前也必须按敏感产物处理。

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
- 多提交分支对目标 base 运行 `docpact lint --root . --merge-base <base-ref> --mode enforce --fail-on-uncovered-change --fail-on-stale-docs`，覆盖已经提交的 Red/Green 切片。
- 所需聚焦门禁、集成 smoke 和最终 `pnpm verify` 均通过。
- Git diff 只包含预期范围，`git diff --check` 通过；Red 是可恢复检查点，最终提交处于 Green 且目的单一。
