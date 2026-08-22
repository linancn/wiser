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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2b55ba6c5d4f88bc058588021169c713ad7f9c51
---

# WISER Web / 产品前端

`apps/web` is the shared Next.js product UI for WISER Platform, Agent EXCON, and Data Foundation. Chinese is the default at `/zh-CN`; English uses `/en`, and `/` redirects to the Chinese Agent EXCON scenario catalog. / `apps/web` 是三个系统共用的 Next.js 产品界面，中文默认，英文路由同构。

## Routes / 路由

| System                | Chinese entry            | English entry         |
| --------------------- | ------------------------ | --------------------- |
| Platform sign-in      | `/zh-CN/login`           | `/en/login`           |
| Agent EXCON scenarios | `/zh-CN/scenarios`       | `/en/scenarios`       |
| Agent EXCON runs      | `/zh-CN/runs`            | `/en/runs`            |
| Data Foundation       | `/zh-CN/data-foundation` | `/en/data-foundation` |

Run pages include overview, collaboration, replay, trace, and diagnostics. Data routes include catalog, ingestion, quality, lineage, search, knowledge, graph, GIS/map, operations, and capabilities.

## Identity and data boundary / 身份与数据边界

- Supabase SSR handles login, cookie refresh, sign-out, and Data Foundation's authenticated server-only DAL.
- Data pages forward the current short-lived Session token from the Next.js server; browsers never receive database, S3, projection, or internal GIS credentials.
- Agent EXCON `reference` mode renders the committed regression preview. `live` mode reads safe v2 operator DTOs server-side with `WISER_WEB_OPERATOR_TOKEN` and `cache: no-store`.
- The complete stack's local Data operator Session does not automatically become the EXCON live operator credential. Missing/invalid EXCON identity produces an explicit unavailable state and never falls back to reference data.

## Run / 运行

The application has a fixed local development port:

```bash
pnpm --filter @wiser/web dev
```

Standalone EXCON preview needs no API:

```bash
AGENT_EXCON_WEB_DATA_MODE=reference pnpm --filter @wiser/web dev
```

Use `pnpm stack:full:up` for unified Auth and Data Foundation integration. Use the server-only `AGENT_EXCON_API_INTERNAL_URL` plus a real least-scope `WISER_WEB_OPERATOR_TOKEN` when testing EXCON `live` mode.

## UI contract / 界面合同

All visible copy lives in both locale dictionaries. The shared AppShell, semantic tokens, persistent light/dark themes, keyboard focus, loading/empty/error states, and responsive behavior apply to every system. A missing API field or unavailable service is shown as a coverage/error state; the UI never fabricates domain or telemetry data.

## Verify / 验证

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
```

See [Frontend development](../docs/src/content/docs/en/development/frontend.md) / [前端开发](../docs/src/content/docs/zh-CN/development/frontend.md) for route, Auth, i18n, theme, and Playwright details.
