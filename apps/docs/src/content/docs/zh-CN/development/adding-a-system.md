---
title: 新增 WISER 系统
description: 在不破坏统一 Auth、共享宿主和依赖边界的前提下，加入第三个或后续业务系统。
docType: workflow
scope: wiser-platform
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 设计或实现 Agent EXCON、Data Foundation 之外的新业务系统时
  - 评审新系统的包、Auth、API、UI、文档和测试完整性时
whenToUpdate:
  - 平台扩展点、系统模板、统一 Auth、UI 或交付门槛变化时
checkPaths:
  - AGENTS.md
  - package.json
  - pnpm-workspace.yaml
  - compose.yaml
  - .env.example
  - packages/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/*-worker/**
  - apps/docs/**
  - infrastructure/**
  - scripts/**
  - .docpact/**
  - .github/workflows/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## 适用目标

“新增系统”是建立新的业务事实边界，不是给现有系统增加一个页面。新系统与 Agent EXCON、Data Foundation 平级，共享 WISER 的 Supabase Auth、Fastify、Next.js、MCP、Docs、设计系统和可观测性入口，同时拥有独立 contracts、core、应用用例和权威数据。

若需求只扩展已有系统已经拥有的事实、状态机或 API，应留在原系统内；不要为了目录整齐制造新的系统边界。

## 开始前：先读取平台合同

创建任何文件前，先用现有平台组合点取得权威阅读集：

```bash
pnpm docpact:route --paths 'AGENTS.md,package.json,apps/api/src/main.ts,apps/web/src/components/app-shell.tsx,apps/mcp/src/index.ts,apps/docs/src/content/docs/zh-CN/meta.json,.docpact/config.yaml'
```

阅读返回文档并确认确实需要新系统，再写下面的双语边界与第一个 Red。新路径建立后，第 7 节会用实际路径重跑 route。

## 0. 先写系统边界

编码前建立一页双语架构文档并回答：

- 系统拥有哪几类权威实体、状态机和审计事件？
- 哪些事实仍由 Platform、Agent EXCON 或 Data Foundation 拥有？
- 公开能力是 REST、GraphQL、MCP、事件还是它们的组合？
- 哪些操作是确定性的，哪些只允许 AI 提建议？
- 权威存储、可重建投影和跨系统引用分别是什么？
- Tenant、Project、Purpose、安全级别、roles 和 scopes 如何限制访问？
- 系统关闭、依赖失效或投影落后时，哪个入口 fail closed？

用公开行为写第一个失败测试，并保留 Red 提交。后续按 contracts → core → application → infra/host 的方向逐步变绿。

## 1. 建立包骨架

推荐从以下结构开始；没有独立 Worker、MCP 或静态资产时不要创建空目录。

```text
packages/
  <system>-contracts/      # @wiser/<system>-contracts
  <system>-core/           # @wiser/<system>-core
  <system>-application/    # @wiser/<system>-application
  <system>-infra/          # @wiser/<system>-infra
apps/
  api/src/<system>/
  web/src/app/[locale]/<system>/
  mcp/src/<system>/        # only when the system exposes MCP
  <system>-worker/         # only for a real independent process
```

所有 package 使用根 workspace 的 TypeScript、format、test 和 build 约定，并通过 `workspace:*` 引用内部包。不要复制一套 lockfile、基础 tsconfig、API host、Web shell 或 Docs 站。

### Contracts

`@wiser/<system>-contracts` 定义可序列化的公开事实：

- 输入/输出 DTO 和运行时 schema；
- 稳定 ID、状态、错误码、Capability/事件版本；
- API、MCP 和测试共享的约束；
- 来自 `@wiser/platform-contracts` 的请求上下文和通用标识。

Contracts 不导入 core、数据库或框架，不包含 Fastify request、ORM row 或内部 secret。破坏性变更必须新增协议版本或提供明确迁移路径。

### Core

`@wiser/<system>-core` 实现状态转换、不变量、确定性计算和领域错误。把时钟、UUID、随机、AI、文件和网络作为显式输入或端口；默认测试对相同输入必须产生相同输出。

AI 可以生成候选、摘要或分类建议，但不能决定确定性分数、授权、状态转换或最终 verdict。AI 输出进入 application 前先按 contract schema 校验。

### Application

`@wiser/<system>-application` 编排用例：加载 aggregate、调用 core、管理事务意图、写审计事件，并通过接口请求持久化或外部系统。它不导入 Fastify、Next.js、具体数据库 client 或 MCP SDK。

Application 可以消费其他系统的公开 contracts；需要其他系统当前数据时，通过一个 HTTP port 调用其公开 API。不要导入对方 core/infra，也不要跨库 join。

### Infrastructure

`@wiser/<system>-infra` 实现 application ports，例如 PostgreSQL repository、对象存储、消息、搜索和外部 HTTP client。每个 adapter 都要有超时、大小边界、结构校验、错误映射和资源关闭路径。

## 2. 选择权威存储

先写清权威数据库和迁移所有者，再创建表：

- 使用 WISER 控制面或 Supabase-managed 数据库时，用 Supabase CLI 创建迁移，并同步 declarative schema、seed 和 pgTAP。
- 若系统需要独立数据库，建立该系统唯一的 checksummed migration runner、advisory lock 和规范迁移目录；不要混入 `supabase/migrations`，也不要复用 Data Foundation 的迁移历史。
- 暴露 schema 的每张表都启用 RLS，并验证 Tenant、Project、ownership 和 scope；只检查 `authenticated` role 不足够。
- 隐藏规则、outcome、job、credential 和幂等记录放在 private schema。
- 复杂写操作使用显式事务、行锁或 optimistic version、唯一约束和 append-only audit event。

系统数据库只保存平台 subject、Tenant 和 Project 的受限引用，不复制用户、Session、membership 或第二套密码体系。

独立数据库采用以下可发现结构，并在根 `package.json` 暴露同构操作命令；系统没有某个生命周期步骤时可以省略，但不能用人工补丁代替：

```text
infrastructure/<system>/postgres/migrations/  # NNNN_*.sql canonical history
packages/<system>-infra/src/migrations/       # checksum runner + advisory lock
scripts/<system>/                             # up/down/migrate/seed/verify/smoke/reset

pnpm <system>:up
pnpm <system>:migrate
pnpm <system>:seed
pnpm <system>:verify
pnpm <system>:smoke
pnpm <system>:down
<EXACT_SYSTEM_RESET_CONFIRMATION> pnpm <system>:reset
```

部署还必须创建彼此独立的 migration owner 与 API role；只有实际存在 Worker 时才创建独立 Worker role。runtime 均为非超级用户、`NOBYPASSRLS`，reset 只能删除该系统 allowlist 内的本机资源并要求精确确认。空库重放在一次性 CI/开发环境中验证；若仓库尚未提供隔离模式，不得在有需保留数据的工作区执行破坏性 reset。

## 3. 接入统一 Auth

新系统必须复用 `@wiser/platform-contracts` 与 `@wiser/platform-auth`：

1. 为人类操作使用 Supabase Session；为 Agent/服务使用由平台签发和撤销的 delegated credential。
2. 定义命名清楚的 scopes，例如 `<system>.resource.read` 和 `<system>.resource.manage`，并加入平台已知 scope registry。
3. 从 Platform resolver 获得 `PlatformRequestContext`，再按 Tenant、Project、Purpose、role、scope、安全上限和 ownership 授权。
4. 把授权上下文传入 application；不要让 repository 从全局环境猜当前身份。
5. 为缺 token、过期 token、错误 Tenant/Project、缺 scope、超安全级别和跨 owner 请求写负向测试。

浏览器永远不接收 service-role key、数据库凭据、delegated secret 或 server-only operator token。生产模式不得支持 Auth off。

## 4. 注册后端入口

在 `apps/api/src/<system>/` 建立 runtime config、application adapter 和一个或多个 `WiserApiModule`：

- 模块 ID 使用唯一点分名称，例如 `<system>.catalog`；
- REST 使用 `/api/<system>/v1`，并在公开 contract 中固定版本；
- 复用共享错误 envelope、request ID、CORS 和 OpenAPI；
- 提供能区分 liveness 与依赖 readiness 的健康信息；
- 写操作要求幂等键，并让 transaction/constraint 保证重试语义；
- 在 `createDefaultApiApp` 中创建系统 runtime，并在 `app.ready()` 前通过 `registerWiserApiModules` 注册其 modules；测试可把同一 module 直接传给 `buildApp`，所有外部资源由 module/runtime 的 `onClose` 释放；
- 用 Fastify `inject()` 验证路由、授权、响应 schema、错误码和无缓存头。

除非有明确隔离或伸缩需求，不建立第二个公共 HTTP server。独立 Worker 只承担异步工作，业务操作仍由 API 进入。

## 5. 可选 Worker、MCP 与 Skill

### Worker

仅在任务需要独立领取、lease、重试、心跳或资源配额时创建 `apps/<system>-worker`。Worker 应使用受限数据库角色、稳定 job type、幂等 handler、死信/失败状态、健康端点和优雅关闭；不得把内存队列当成权威状态。

### MCP

若 Agent 需要该系统能力，在 `apps/mcp/src/<system>/` 实现 `WiserMcpModule`：

- Tool/Resource schema 复用系统 contracts；
- client 只调用 `/api/<system>/v1`，不直读数据库；
- 设置超时、响应上限和结构校验；
- 写 Tool 显式描述幂等和破坏性；
- 在 stdio 与 HTTP transport 的同一组合根注册并测试。

Skill 只说明发现、调用、恢复和安全工作流。它同样通过 HTTP/MCP，不内嵌服务凭据或数据库路径。

## 6. 接入统一前端

新系统页面放在 `apps/web/src/app/[locale]/<system>/`，并复用现有 `AppShell`、语义 token、组件和主题机制。

必须同时完成：

- 在系统导航加入新入口，并保持 Agent EXCON、Data Foundation 和新系统之间切换一致；
- 为 `zh-CN` 和 `en` 提供相同路由、状态、操作和信息层级，`zh-CN` 仍为默认；
- 所有可见文案进入 `apps/web/src/lib/i18n.ts` 的两个 dictionary，不在组件中散落单语字符串；
- 使用 server-only DAL 读取 Session 和内部 API 地址，浏览器只调用同源 route 或安全 DTO；
- 同时支持浅色/深色、键盘操作、focus 状态、响应式和错误/空/加载状态；
- 数据失败时展示真实 unavailable/authorization/contract 状态，不退回静态样例伪造成功。

至少为两个 locale 的主入口、登录/授权失败、核心任务、主题和键盘路径增加 Vitest/Playwright 覆盖。

## 7. 文档与 Docpact

每个系统至少需要：

- `architecture/<system>.md`：事实所有权、依赖和存储边界；
- `protocols/<system>-*.md`：公开 REST/GraphQL/MCP 契约；
- `development/` 中的本机配置、后台进程和测试说明；
- 根 README 与文档首页中的系统入口；
- 中文和英文语义同构页面、导航 `meta.json` 与完整 Docpact frontmatter。

路径建立后，先对每个新系统都必改的完整纵切重新运行：

```bash
pnpm docpact:route --paths 'package.json,pnpm-workspace.yaml,.env.example,compose.yaml,README.md,README.en.md,packages/<system>-*/**,packages/platform-contracts/**,packages/platform-auth/**,apps/api/src/<system>/**,apps/api/src/platform/**,apps/api/src/main.ts,apps/web/src/app/*/<system>/**,apps/web/src/components/app-shell.tsx,apps/web/src/lib/i18n.ts,apps/web/e2e/**,apps/docs/src/content/docs/*/index.mdx,apps/docs/src/content/docs/*/architecture/<system>.md,apps/docs/src/content/docs/*/protocols/<system>-*.md,apps/docs/src/content/docs/*/development/*.md,apps/docs/src/content/docs/*/meta.json,.docpact/config.yaml,.github/workflows/**'
```

再只对实际创建的可选边界运行第二次 route，例如 `apps/mcp/src/<system>/**,apps/mcp/src/index.ts,apps/mcp/src/http-main.ts`、`apps/<system>-worker/**`、`infrastructure/<system>/**`、`scripts/<system>/**`。不存在的可选目录不要放进 glob；`no-tracked-path-matches` 必须修正输入而不是忽略。

每个 Red/Green 提交前都运行 `pnpm docpact:check`，避免 worktree lint 在提交后看不到该切片。新系统必然扩展 ownership、coverage、inventory 和规则，因此必须运行 `pnpm docpact:validate`；最终还要运行下面的 branch-wide lint。不要用 waiver 或 baseline 掩盖新系统未被文档图覆盖。

## 8. 完成检查表

| 范围        | 必须证明                                                                            |
| ----------- | ----------------------------------------------------------------------------------- |
| Contracts   | schema 正负例、版本兼容、稳定错误码、所有消费者 typecheck                           |
| Core        | 纯且确定性；不变量、状态转换和边界值有单元测试                                      |
| Application | 用例、事务、幂等、并发和外部端口失败均有测试                                        |
| Auth        | Supabase/delegated credential、Tenant/Project、scope、ownership、RLS 负向用例       |
| Database    | 空库迁移、重复迁移、约束、回滚/恢复策略和非超级用户运行角色                         |
| API         | 模块注册、OpenAPI、健康、错误 envelope、资源关闭和 HTTP contract 测试               |
| Worker      | claim/lease/heartbeat/retry、重复投递、优雅关闭和 metrics/health                    |
| MCP/Skill   | 只走 HTTP、schema/大小/超时、授权失败和 transport 一致性                            |
| Web         | 中英文同构、中文默认、深浅主题、键盘、响应式和 fail-closed 状态                     |
| Docs        | 双语页面、导航、frontmatter、Docpact 路由/覆盖与无重复历史叙事                      |
| Operations  | Compose 配置、秘密边界、日志、健康、smoke 和停止路径                                |
| CI          | 新 workspace scripts、数据库 lifecycle、Playwright/smoke 与 Docpact 已接入 workflow |

每个新 workspace 必须声明实际适用的 `typecheck`、`build` 和 `test` scripts；包内 spec 使用根 Vitest 能发现的 `*.spec.ts` 位置。没有 test script 的 app 或无法被根 Vitest 收集的测试会被 `pnpm verify` 跳过，不能算已验证。

每个 Green 检查点运行拥有该行为的聚焦测试；数据库和浏览器改动追加对应验证。可交接状态按顺序运行（删除确实不适用的可选门禁，并在评审说明原因）：

```bash
pnpm <system>:verify
pnpm <system>:smoke
pnpm supabase:verify   # if the Supabase-managed schema changed
pnpm data:verify       # if Data Foundation integration changed
pnpm --filter @wiser/web test:e2e   # if the system has Web UI
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
pnpm docpact:check
pnpm docpact:validate
docpact lint --root . --merge-base main --mode enforce --fail-on-uncovered-change --fail-on-stale-docs
pnpm verify            # final repository convergence
```

提交保持单一目的：contract/core、application/API、数据库、Worker/MCP、UI、文档分别形成可恢复的小提交。一个系统只有在其公开纵切、授权负向路径和运行说明都可验证时才算接入完成。
