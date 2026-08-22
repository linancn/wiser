---
title: 前端开发
description: WISER 产品 Web 与文档站的职责、路由、数据访问、国际化、主题和验收流程。
docType: workflow
scope: wiser-frontend
status: active
authoritative: true
owner: wiser
language: zh-CN
whenToUse:
  - 新建或修改 WISER 产品页面、文档页面、共享 Shell 或浏览器交互时
whenToUpdate:
  - 前端应用边界、路由、数据访问、身份、国际化、主题或测试规则变化时
checkPaths:
  - apps/web/package.json
  - apps/web/src/**
  - apps/web/e2e/**
  - apps/docs/package.json
  - apps/docs/src/**
  - apps/docs/e2e/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

## 两个前端应用

| 应用        | 本机入口                | 职责                                                            | 代码入口                                        |
| ----------- | ----------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `apps/web`  | `http://127.0.0.1:3000` | WISER 产品界面：统一登录、Agent EXCON 与 Data Foundation 工作区 | `src/app/[locale]`、`src/components`、`src/lib` |
| `apps/docs` | `http://127.0.0.1:4321` | WISER 的 Fumadocs 文档站：架构、协议、运行手册与开发说明        | `src/app`、`src/content/docs/{zh-CN,en}`        |

两个应用共享 WISER 的视觉语言、中文默认策略和深浅色能力，但不共享运行时状态。产品功能只进入 `apps/web`，开发者说明只进入 `apps/docs`；不要把文档站做成另一个产品控制台，也不要把长篇开发说明嵌进产品页面。

本机运行模式和完整端口表见[本机开发环境](/development/local-environment/)。视觉 Token、组件语义和无障碍合同见[WISER Design System](/architecture/design-system/)。
Portal、导航层级、产品命名和用户文案见[产品界面与内容设计](/development/product-experience/)。

## 语言与主题合同

### 产品 Web

- 受支持的 locale 是 `zh-CN` 和 `en`；`/` 重定向到公开 Portal `/zh-CN`，英文 Portal 是 `/en`。
- 每个产品页面放在 `src/app/[locale]` 下，因此中英文天然使用相同的 locale-free slug。例如 `/zh-CN/runs` 对应 `/en/runs`。
- 可见文案进入 `src/lib/i18n.ts` 的两套字典。中文是默认表达；HTTP、MCP、Run、DataItem 等协议或领域标识可保留英文。
- `AppShell` 统一承载 Portal 入口、一级系统切换、当前身份、主题和语言切换；第二行只显示当前系统的工作区导航。新增页面继续使用该 Shell，不创建平行的全局导航。
- 主题使用语义 Token；`wiser-theme` 保存用户选择，首次访问尊重系统偏好，并在 hydration 前设置 `data-theme`。浅色和深色必须保留相同的信息层级、状态含义和操作。

### 文档站

- 中文内容位于 `src/content/docs/zh-CN`，默认路由不带 locale 前缀；英文内容位于 `src/content/docs/en`，路由以 `/en` 开头。
- 一对翻译页面使用相同的相对路径和 slug，并在两份 `meta.json` 的同一位置出现。
- 文档站通过 Fumadocs provider 提供中文/英文、浅色/深色/跟随系统和静态搜索。新增内容必须在两种语言和两种主题下可读。

## 产品 Web 路由

| 工作区                 | 路由                                                                                                   |
| ---------------------- | ------------------------------------------------------------------------------------------------------ |
| WISER Portal           | `/[locale]`；允许匿名查看平台与系统介绍                                                                |
| 统一身份               | `/[locale]/login`、`/[locale]/auth/login`、`/[locale]/auth/callback`、`/[locale]/auth/sign-out`        |
| Agent EXCON 场景       | `/[locale]/scenarios`、`/[locale]/scenarios/[scenarioId]`                                              |
| Agent EXCON 运行       | `/[locale]/runs`、`/[locale]/runs/[runId]` 及 `collaboration`、`diagnostics`、`trace`、`replay` 子路由 |
| Data Foundation 总览   | `/[locale]/data-foundation`                                                                            |
| Data Foundation 工作区 | `catalog`、`ingestions`、`quality`、`search`、`knowledge`、`graph`、`geo`、`map`、`capabilities`       |
| Data Foundation 详情   | `catalog/[dataItemId]`、`ingestions/[ingestionId]`、`operations/[operationId]`、`lineage/[dataItemId]` |

Supabase 模式中，Portal、登录和 Auth transport 公开；其他 locale 产品路由要求 Proxy 取得已验证的 authenticated claims，否则保留目标地址并跳转到同语言登录页。`WISER_AUTH_MODE=off` 只保留本机 reference 预览。

页面默认使用 Server Component。只有浏览器交互、浏览器 API 或局部状态需要时才增加 Client Component；不要因为父页面包含交互就把取数和身份逻辑下放到浏览器。

## Agent EXCON 读模型

Agent EXCON 页面支持两个明确的数据模式：

| 模式        | 用途                                                       | 失败行为                                              |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `reference` | 默认的确定性设计参考、构建和端到端测试数据                 | 页面明确标记为设计预览                                |
| `live`      | Server Component 从 Agent EXCON v2 HTTP API 读取操作员投影 | 显示可操作的 unavailable/error 状态，绝不混入参考数据 |

模式由服务端的 `AGENT_EXCON_WEB_DATA_MODE` 选择。`live` 请求使用 `cache: no-store`，API origin 和 `WISER_WEB_OPERATOR_TOKEN` 只能留在服务端。现有 DTO 没有提供的信息应显示覆盖缺口或空态，不能从参考样例补齐，也不能在前端推断 Agent、Span、回放视角或裁决事实。

## Data Foundation 数据与身份

Data Foundation 没有 reference 模式。所有页面通过 `src/lib/data-foundation-dal.server.ts` 的 server-only DAL 读取实时 API；未配置、未登录、无权限、响应不符合契约或上游不可用时，页面以分类失败态收敛，不展示伪造数据。

访问顺序是：

1. Next.js proxy 与 Server Component 使用 Supabase SSR cookie session。
2. 服务端先通过 `getClaims()` 核验用户、会话、角色和过期时间，再从 `getSession()` 取得 access token，并确认两者属于同一个会话。
3. DAL 把 Bearer token 与租户、项目、用途上下文转发给 WISER API；请求禁用缓存并限制超时、媒体类型和响应大小。
4. 浏览器只接收 Supabase URL 与 publishable key。数据库凭据、service-role、内部 API origin、operator token 和原始上游错误永不进入 Client Component 或序列化 props。

地图瓦片也使用同源 Web 路由，由服务端代理附加身份和范围；不要把内部 GIS 地址或 access token 写进地图 URL。

## 实现一个新页面

1. 先确认页面属于 Portal、智能体演练场还是数据基座，并复用 `Portal → 系统 → 工作区 → 领域对象` 层级与既有领域术语。
2. 在 `src/app/[locale]` 增加一个 locale-free slug，只创建一份页面实现；中英文内容来自同构字典。
3. 默认在 Server Component 读取数据。EXCON 使用既有 read-model source；Data Foundation 使用 server-only DAL；不要直接访问数据库、投影库或内部 GIS 服务。
4. 为 loading、empty、authentication、authorization、contract 和 unavailable 状态选择适用的明确呈现。失败时保留用户可执行的恢复动作。
5. 使用共享 Shell、语义 Token 和既有组件原语；新原语应服务多个页面，而不是只包裹一处样式。
6. 同时补齐中文与英文文案、键盘名称、标题、元数据和语言切换目标。
7. 先写会失败的单元、契约或路由测试，再实现页面；最后用 Playwright 验收真实渲染。

## 测试与浏览器验收

快速反馈使用：

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/docs typecheck
```

交付前至少运行受影响应用的构建和端到端测试：

```bash
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
```

这两个标准 Playwright 配置自启隔离的开发服务器，主要验证 reference/fixture 驱动的路由、语言、主题和交互；它们不证明统一 Auth、Data 数据库或 EXCON live credential。Data 的登录与真实 API 纵切由 `pnpm stack:full:up` / `pnpm data:smoke` 覆盖。

仓库当前没有自动签发 EXCON operator credential 的 full-stack Playwright 命令。验证 EXCON live 时，先通过受信任 operator 流程取得真实 `WISER_WEB_OPERATOR_TOKEN`，再以 `AGENT_EXCON_WEB_DATA_MODE=live` 和服务端 `AGENT_EXCON_API_INTERNAL_URL` 运行一个隔离 Web 实例或专用测试；没有这一步就必须把结果表述为 reference UI 验证，而不是 live/Auth E2E。

可复现的无模型 EXCON live Web 路径是 scripted Showcase。它启动隔离 Lab/API/Web，以 host-only operator token 配置 `live` read model，并在 status 中返回 `/collaboration` URL：

```bash
pnpm showcase:preflight
pnpm showcase:start --profile scripted
pnpm showcase:status
pnpm showcase:stop
```

该路径证明 live read model 与协作页面，不是 Playwright 自动交互；展示后必须运行 stop 并确认 TTL/credential 清理。

Playwright 使用用户可感知的 role、label、可见文本或稳定 test id 定位。每个新 UI 的验收清单如下：

- 中文和英文保持相同路由、信息、状态与操作，英文页面没有遗漏的中文叙述文案。
- 浅色和深色都保持足够对比度；主题和语言切换后当前工作区不丢失。
- 桌面与 390px 窄屏没有横向溢出，主操作无需依赖 hover。
- 键盘可以到达所有交互，焦点清晰，状态不只依赖颜色；动画尊重 reduced motion。
- 页面没有浏览器异常或意外 console error，失败态不泄露内部凭据和上游响应正文。
- EXCON 的 reference/live 边界和 Data Foundation 的“只用实时 API”边界有测试保护。
- 新路由、字典键、数据契约和权限失败都具有聚焦测试；截图用于视觉比较，不代替语义断言。
- 相关架构、协议或开发文档同步更新，并通过 Docpact 和根目录 `pnpm verify`。
