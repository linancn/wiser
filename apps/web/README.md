---
title: WISER Web component guide
docType: component-guide
scope: apps/web
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when running or changing the shared WISER product frontend
whenToUpdate:
  - when Web routes, identity, read models, locales, themes, or verification changes
checkPaths:
  - apps/web/**
  - apps/api/src/platform/**
  - apps/api/src/v2-*
  - apps/api/src/data-foundation/**
lastReviewedAt: 2026-09-08
lastReviewedCommit: 568386eed3b8fb0b090376874270ebac2a91787c
---

# WISER Web / 产品前端

`apps/web` is the shared Next.js product UI for the WISER Portal, Data Foundation, and Agent EXCON. Chinese is the default at the public `/zh-CN` Portal, English uses `/en`, and `/` redirects to `/zh-CN`. / `apps/web` 是 WISER Portal、数据基座与智能体演练场共用的 Next.js 产品界面；Portal 允许匿名了解平台，再引导统一登录。

Portal 提供“让智能体接入 WISER”复制入口，使用公开的 `WISER_AGENT_SETUP_URL`；复制本身不授予访问权限。 / Portal provides “Connect your agent to WISER” through the public `WISER_AGENT_SETUP_URL`; copying grants no access. See [Agent setup](../docs/src/content/docs/en/protocols/agent-setup.md) / [智能体接入](../docs/src/content/docs/zh-CN/protocols/agent-setup.md).

## Routes / 路由

| System                | Chinese entry            | English entry         |
| --------------------- | ------------------------ | --------------------- |
| WISER Portal          | `/zh-CN`                 | `/en`                 |
| Platform sign-in      | `/zh-CN/login`           | `/en/login`           |
| Data Foundation       | `/zh-CN/data-foundation` | `/en/data-foundation` |
| Agent EXCON scenarios | `/zh-CN/scenarios`       | `/en/scenarios`       |
| Agent EXCON runs      | `/zh-CN/runs`            | `/en/runs`            |

Run pages include overview, collaboration, replay, trace, and diagnostics. Data routes include catalog, ingestion, quality, lineage, search, knowledge, graph, GIS/map, operations, and capabilities.

## Identity and data boundary / 身份与数据边界

- Supabase SSR handles login, cookie refresh, sign-out, and Data Foundation's authenticated server-only DAL.
- In Supabase mode, Portal and Auth routes are public. Other localized product routes require verified authenticated claims and preserve the requested destination through sign-in. Auth-off is local preview only.
- Data pages forward the current short-lived Session token from the Next.js server; browsers never receive database, S3, projection, or internal GIS credentials.
- Agent EXCON `reference` mode renders the committed regression preview. `live` mode reads safe v2 operator DTOs with the verified current Supabase user session and `cache: no-store`.
- The API rechecks EXCON operator authorization for that user. An invalid session never falls back to a service identity or reference data. Static operator tokens remain limited to local Auth-off development.

## Run / 运行

The application defaults to `http://127.0.0.1:3100` / 本机开发默认入口为 `http://127.0.0.1:3100`：

```bash
pnpm --filter @wiser/web dev
```

Standalone EXCON preview needs no API:

```bash
AGENT_EXCON_WEB_DATA_MODE=reference pnpm --filter @wiser/web dev
```

Use `pnpm stack:full:up` for unified Auth and Data Foundation integration. Configure the server-only `AGENT_EXCON_API_INTERNAL_URL` and sign in as an authorized operator when testing EXCON `live` mode with Supabase.

The graph workspace uses G6 5.1.1 with client-only loading, bounded HTTP results and accessible entity selection. / 图谱工作区按需加载 G6 5.1.1，并以有界 HTTP 结果提供画布和键盘实体选择。

## UI contract / 界面合同

All visible copy lives in both locale dictionaries. The shared AppShell follows `Portal → system → workspace → domain object`; Data Foundation precedes Agent EXCON, whose Chinese product name is `智能体演练场`. Semantic tokens, persistent light/dark themes, keyboard focus, loading/empty/error states, and responsive behavior apply to every system. Ordinary UI never exposes HTTP status, environment variables, internal URLs, or operator recovery commands, and it never fabricates domain or telemetry data.

## Verify / 验证

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
```

See [Frontend development](../docs/src/content/docs/en/development/frontend.md) / [前端开发](../docs/src/content/docs/zh-CN/development/frontend.md) for route, Auth, i18n, theme, and Playwright details.

Data exploration at `/[locale]/data-foundation/explore` uses shared `@wiser/data-contracts` schemas and the verified-session `/api/data-foundation/explore` endpoint for version-pinned resource queries, pagination and selection details. / 数据探索页面通过共享契约与当前登录会话完成固定版本查询、分页和详情选择。

Data Explorer links resource, record and MapLibre views through one authorized query and shared selection. Dev/build automatically prepares matching MapLibre 6.8.0 worker modules. The checked-in Natural Earth overview basemap is public-domain and has a source/hash manifest in `public/basemap/source.json`. Business records and geometries continue to come exclusively from the authenticated HTTP API.

Exploration invalidation and expiry clear all rendered views and selection together while retaining editable form conditions for retry. / 探索授权失效或到期时，各视图与选择一起清除，表单条件保留以便重新查询。

Record conditions, sorting and column selection create one authorized file query reused by record, map and provenance views. / 记录条件、排序和列配置创建同一授权文件查询，并在记录、地图和溯源视图间复用。

The statistics view aggregates a selected source through the shared HTTP query and offers keyboard group selection alongside its chart. / 统计视图通过共享 HTTP 查询聚合所选来源，图表配有键盘可用的分组选择。

Graph exploration includes bounded neighbor pages and current-page directed path highlighting, with keyboard controls and shared identity. / 图谱探索支持有界邻居分页和当前页有向路径高亮，复用键盘控件与共享身份。

Exploration groups specialist tools without breaking deep links, preserves aggregate units on narrow screens, and offers responsive graph layouts and viewport controls. / 数据探索集中专业工具入口并保留深链接，窄屏统计保留单位，图谱提供响应式布局及视角控件。
