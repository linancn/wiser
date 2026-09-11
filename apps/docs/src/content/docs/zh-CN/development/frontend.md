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
lastReviewedAt: 2026-09-11
lastReviewedCommit: ecb2161da8ade7e2890f5bcdd98840121c478ded
---

## 两个前端应用

| 应用        | 本机入口                | 职责                                                            | 代码入口                                        |
| ----------- | ----------------------- | --------------------------------------------------------------- | ----------------------------------------------- |
| `apps/web`  | `http://127.0.0.1:3100` | WISER 产品界面：统一登录、Agent EXCON 与 Data Foundation 工作区 | `src/app/[locale]`、`src/components`、`src/lib` |
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

Portal 与 Docs 提供双语智能体接入复制操作，使用服务端配置的公开 `WISER_AGENT_SETUP_URL`。剪贴板权限被拒绝时显示可选择的指令，复制成功只表示指令已复制，不附带凭据或项目数据。[智能体接入协议](/protocols/agent-setup/) 定义发行校验和独立的连接验证。生产 Docs 页面预渲染，因此构建时也需要目标公开地址。

## Agent EXCON 读模型

Agent EXCON 页面支持两个明确的数据模式：

| 模式        | 用途                                                       | 失败行为                                              |
| ----------- | ---------------------------------------------------------- | ----------------------------------------------------- |
| `reference` | 默认的确定性设计参考、构建和端到端测试数据                 | 页面明确标记为设计预览                                |
| `live`      | Server Component 从 Agent EXCON v2 HTTP API 读取操作员投影 | 显示可操作的 unavailable/error 状态，绝不混入参考数据 |

模式由服务端的 `AGENT_EXCON_WEB_DATA_MODE` 选择。`live` 请求使用 `cache: no-store`，API origin 和刚验证的当前用户 Access Token 只能留在服务端。Supabase 模式中 EXCON 与 Data 共用 Session verifier；静态 `WISER_WEB_OPERATOR_TOKEN` 仅用于本机 Auth-off 开发。现有 DTO 没有提供的信息应显示覆盖缺口或空态，不能从参考样例补齐，也不能在前端推断 Agent、Span、回放视角或裁决事实。

## Data Foundation 数据与身份

Data Foundation 没有 reference 模式。所有页面通过 `src/lib/data-foundation-dal.server.ts` 的 server-only DAL 读取实时 API；未配置、未登录、无权限、响应不符合契约或上游不可用时，页面以分类失败态收敛，不展示伪造数据。

访问顺序是：

1. Next.js proxy 与 Server Component 使用 Supabase SSR cookie session。
2. 服务端先通过 `getClaims()` 核验用户、会话、角色和过期时间，再从 `getSession()` 取得 access token，并确认两者属于同一个会话。
3. DAL 把 Bearer token 与租户、项目、用途上下文转发给 WISER API；请求禁用缓存并限制超时、媒体类型和响应大小。
4. 浏览器只接收 Supabase URL 与 publishable key。数据库凭据、service-role、内部 API origin、operator token 和原始上游错误永不进入 Client Component 或序列化 props。

地图瓦片也使用同源 Web 路由，由服务端代理附加身份和范围；不要把内部 GIS 地址或 access token 写进地图 URL。

图谱页在客户端按需加载 G6 5.1.1，使用有界受控数据、共享主题 Token，以及带精确版本/证据链接的键盘实体列表。`e2e-live/query-visualization.spec.ts` 在桌面和手机宽度验证真实 HydroATLAS 图谱与长搜索摘要；需要已准入的研究案例和明确的本机测试登录信息。

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

在完整栈验证 EXCON live 时，通过 Supabase 登录具备 EXCON operator Role 的用户，并配置 `AGENT_EXCON_WEB_DATA_MODE=live` 和服务端 API origin。读模型转发经过验证的当前 Session；认证失败时不回退服务令牌。仅 reference 测试不能证明 live/Auth E2E。

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

`/[locale]/data-foundation/explore` 工作区与 API 共享严格探索契约。紧凑查询栏、资源表格与选择详情面板将结果区置于页面上方。服务端渲染建立或恢复授权结果集，后续请求经过验证当前 Session 的 Next.js 入口 `/api/data-foundation/explore`。调整筛选建立新版本清单，分页沿用同一 `queryId`。数据名称支持键盘操作，详情显示精确版本、就绪状态及来源限制；未知分析数量不会显示为零。

探索地图按需加载高德 JS API 2.0 官方底图，以及透明的 MapLibre GL JS 6.8.0、react-map-gl 8.1.3 业务图层。`apps/web/scripts/prepare-maplibre.mjs` 在开发和构建前，将匹配的 Worker 与共享模块复制到同源、带版本号的公共目录；生成文件不提交 Git。显示坐标与视角在高德边界同步，授权查询与原文件保留来源坐标。高德标识和版权信息始终可见。

探索工作区的统计页签按需加载 [Apache ECharts 6.1.0](https://github.com/apache/echarts/releases/tag/6.1.0)，使用 SVG 渲染和所需图表组件，展示服务端计算的完整授权查询就绪状态数量。选择图柱或对应的键盘可用文字按钮，将同一状态条件应用到资源探索。图表颜色遵循语义变量；卸载时释放尺寸/主题观察器和图表实例。资源数量不能表述为记录数或科学观测数。

当响应表明授权或固定成员范围失效，或结果到达声明的过期时间时，探索工作区一并清除当前查询、选择、文件详情及已渲染视图；从后台或历史页面恢复时再次检查同一截止时间。旧查询的迟到失败不能清除新查询，被中止的请求也不能恢复旧数据。查询表单条件保留，便于重新获取当前有权查看的结果。临时地图故障卸载画布并提供重新加载，不展示上游诊断。

记录探索提供可展开的条件表单，支持最多八个类型明确的比较条件、标量排序及可选的 1–32 列配置。文本编号保留前导零；空白或非有限数值不能作为数值条件提交。应用条件会创建新的单版本／文件授权查询、清除选择、新增历史记录并打开记录视图；记录、地图瓦片和记录溯源使用同一谓词。刷新后从授权查询恢复配置，清除条件则恢复该版本的记录浏览。数值比较使用来源值，不推断或换算单位。

选择资源后，统计视图提供来源记录聚合，字段控件与资源就绪状态计数分开表达。图表配有精确值表格及可通过键盘操作的分组选择。单位明确显示，未知分组不会被悄悄替换成不完整的空值条件。

探索协议 1.8 增加时间条件、时间排序，以及小时、日、月、年聚合。源格式为 `iso-offset`、`dmy-local` 或 `ymd-local`；`utcOffsetMinutes` 必须明确填写 −840 至 840 的固定偏移，不推断时区或夏令时。ISO 源值使用自身偏移；无偏移的源时间使用配置偏移，该偏移同时定义日历分组。无效日期归入无法分组，不自动修正。边界使用最多六位小数的 UTC 字符串，范围采用包含起点的 `gte` 和不包含终点的 `lt`，源字符串保持不变。浏览器支持时间折线、完整时间段刷选和等价的键盘范围控件，不同单位使用独立序列。所有视图及 MVT 复用相同条件。1.7 发现协议保持不可变。

探索协议 1.10 增加不可变的 `spec.spatialBounds`，按 WGS84 西、南、东、北排列。记录、聚合、图谱记录回查和查询 MVT 在聚合前使用相同的已验证几何相交条件。资源及来源图概览显示匹配版本；来源就绪统计仍表示已索引内容。查询清单保留底层授权范围的版本与批次，使通过 `baseQueryId` 清除或改变范围时不刷新解析结果、不丢失原始范围。即使位于地图范围外，所有固定成员仍需重新授权。地图提供点、线、面显隐、图例、本地字体聚合数量与视口筛选；图层显隐只改变呈现，不改变查询授权或计数。未验证坐标的数据明确排除。1.9 发现协议保持不可变。

图谱探索提供键盘可用的文件、证据和记录展开、邻居分页、带文字的关系开关，以及限定当前页的有向路径控件。路径高亮更新 G6 节点／边状态，不替换画布。两种语言均显示计数单位、截断状态与恢复操作；切换焦点会清除路径端点和游标。

数据工作区导航将检索、知识和专业空间／图谱工具归入数据探索，原有深链接继续有效，探索工具栏提供专业入口。窄屏下只有资源表可以隐藏提供机构列；记录与聚合表在自身滚动区域内保留全部所选字段和单位。来源统计将资源就绪概况放入独立折叠区，仅在展开时挂载图表。来源层级图谱宽度小于 560 像素时由 Worker 计算纵向布局，并提供键盘可用的缩放、全图及所选节点定位控件；视角操作不使用动画。

宽度不超过 900 像素时，可通过底部按钮在非模态抽屉中查看所选来源。展开后键盘焦点进入带名称的详情区域；收起或 Escape 将焦点返回按钮，保留当前选择。取消选择时按需将焦点返回当前视图页签。桌面详情仍在侧栏中滚动。G6 内部画布图层不参与 Tab 顺序，键盘交互由有名称的视角控件和来源节点列表提供。

Portal 根据已验证会话选择主操作：已登录用户进入数据工作区，匿名用户进入登录页。数据目录使用每页 25 行的游标分页及可键盘聚焦的内部滚动表格，后续页和返回第一页均保留名称条件。列表保留来源、发布、质量和安全信息，并引导结合详情中的检查范围与内容就绪状态判断。

综合与知识检索使用每页 10 条游标请求，继续查询和返回首页时保留关键词。展示名称由服务端通过同一授权 DAL 补充，每次最多并发读取六个精确版本，按本次请求去重且不跨会话缓存；可选名称读取失败时仍提供资源链接。目录与质量列表每页 25 条。探索入口支持完整的 `dataItem`/`version` 地址参数对，经共享查询契约校验和 HTTP API 再授权；参数对不能与已有 query 或 saved-view 标识混用。接入和智能体接入页面复用配置的公开智能体接入地址。`e2e-live/data-foundation-product.spec.ts` 验证研究案例、游标跳转、保留版本的视图入口，以及语言/主题/视口组合。

原文件字节通过 `GET/HEAD /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/{assetId}/content` 提供。API 重复既有资产／版本授权和审计，仅为内部存储入口签名，并以两分钟截止和单范围请求支持流式传输，不暴露签名地址。验证当前会话的 Web 入口 `/api/data-foundation/assets/{versionId}/{assetId}` 提供带文件名的附件或白名单内的惰性预览，剥离上游 Cookie，使用 no-store、nosniff 和沙箱内容策略。原文件下载与有界查询页导出相互独立。资源页先显示解析内容，再展示治理信息，保持精确版本与文件身份，提供分页表格、来源文档、结构化内容及地图／图谱联动。嵌套结构按有界分组懒加载，展示标签之外保留原始标签。

二维栅格波段与 NetCDF 变量在已保存像元不超过 65,536 个时直接绘制真实数值，提供透明无效值、各波段色标与可用键盘操作的行列像元检查。零值和负值保持原样。缺少像元、非数值或更高维数组保留结构化内容与原文件下载，不生成虚构影像。

原生 PDF 预览仅在响应类型精确为 `application/pdf` 时使用浏览器 PDF 阅读器，保留 nosniff 和受限 CSP；不添加会阻止原生阅读器的 iframe sandbox。HTML 等其他文档仍保留服务端 sandbox 策略，客户端文件扩展名不能放宽 HTML 的响应策略。

资源内容为两份完整解析表格挂载 `DataReconciliation`。同源核验路由复用已验证会话 DAL、严格 Capability 契约、客户端幂等键和审核版本前提。候选与人工核验观测计数仅覆盖本批规则范围。结果和来源成员分别有界分页，窄屏在表格内部滚动。权限拒绝清除保留证据并使旧请求响应失效。
