---
title: WISER Docs component guide
docType: component-guide
scope: apps/docs
status: active
authoritative: true
owner: wiser
language: bilingual
whenToUse:
  - when running or changing the WISER documentation application
whenToUpdate:
  - when docs routes, locales, content structure, build, or verification changes
checkPaths:
  - apps/docs/package.json
  - apps/docs/source.config.ts
  - apps/docs/src/app/**
  - apps/docs/src/components/**
  - apps/docs/src/content/**
  - apps/docs/src/lib/**
  - apps/docs/e2e/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

# WISER Docs / 文档应用

`apps/docs` is the single Fumadocs site for WISER Platform, Agent EXCON, Data Foundation, and future systems. `apps/docs` 是所有 WISER 系统共用的 Fumadocs 文档站。

## Entrypoints / 入口

- Chinese (default) / 中文（默认）：<http://127.0.0.1:4321/>
- English / 英文：<http://127.0.0.1:4321/en/>
- Application routes / 应用路由：`src/app/`
- Documentation content / 文档内容：`src/content/docs/{zh-CN,en}/`
- Navigation / 导航：each directory's `meta.json`

## Run / 运行

Install dependencies once from the repository root, then start the fixed local port:

```bash
pnpm install --frozen-lockfile
pnpm --filter @wiser/docs dev
```

## Content rules / 内容规则

- Every visible page exists at the same locale-free slug in `zh-CN` and `en`.
- Chinese is the default; both languages preserve the same meaning, routes, states, and actions.
- Current architecture and executable workflows belong in the site. Release narratives and superseded plans stay in Git history or issue tracking.
- Package versions come from manifests/lockfile; container versions come from Compose/version records. Do not copy transient version inventories into prose.
- Add each page to the relevant `meta.json`, give governed Markdown complete Docpact frontmatter, and update links in the same change.

## Verify / 验证

```bash
pnpm --filter @wiser/docs typecheck
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
```

The human workflow is documented in [Development documentation](./src/content/docs/en/development/index.md) and [Quick start](./src/content/docs/en/quick-start.md). / 面向人的开发流程见[开发手册](./src/content/docs/zh-CN/development/index.md)与[快速开始](./src/content/docs/zh-CN/quick-start.md)。
