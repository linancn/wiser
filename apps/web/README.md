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
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

# WISER Web / 产品界面

`apps/web` 是 WISER Portal、数据基座与智能体演练场共用的产品网页。中文是默认语言：`/` 跳转至 `/zh-CN`，英文入口为 `/en`。Portal 与登录页公开；业务工作区依照当前登录账号和项目权限展示。 / `apps/web` serves the Portal, Data Foundation, and Agent EXCON. Chinese is the default language, and business workspaces show only what the signed-in account may access.

## 用户从哪里开始 / Where users start

| 任务 / Task                                | 中文入口                 | English entry         |
| ------------------------------------------ | ------------------------ | --------------------- |
| 了解 WISER / Learn about WISER             | `/zh-CN`                 | `/en`                 |
| 登录 / Sign in                             | `/zh-CN/login`           | `/en/login`           |
| 查阅和管理项目访问 / Review project access | `/zh-CN/account/access`  | `/en/account/access`  |
| 探索资料、记录与地图 / Explore data        | `/zh-CN/data-foundation` | `/en/data-foundation` |
| 查看演练场景 / Browse scenarios            | `/zh-CN/scenarios`       | `/en/scenarios`       |
| 查看演练运行 / Review exercise runs        | `/zh-CN/runs`            | `/en/runs`            |

数据基座还有目录、接入任务、质量、检索、知识、关系、地图与数据操作工作区。演练运行可查看概览、协作、评测、追踪与回放。所有页面按当前项目和资料权限重新读取数据。 / Data Foundation also has catalog, intake, quality, search, knowledge, relation, map, and operation workspaces. A run offers overview, collaboration, evaluation, trace, and replay. Reads are scoped to the current project and permissions.

Portal 提供“让智能体接入 WISER”的设置复制入口；复制指令本身不授予权限。参见[智能体接入](../docs/src/content/docs/zh-CN/protocols/agent-setup.md) / [Agent setup](../docs/src/content/docs/en/protocols/agent-setup.md)。

## 运行 / Run

从仓库根目录安装依赖，再启动网页： / Install dependencies from the repository root, then start the web app:

```bash
pnpm install --frozen-lockfile
pnpm --filter @wiser/web dev
```

默认地址为 `http://127.0.0.1:3100`。完整的登录和数据服务本机体验见[快速开始](../docs/src/content/docs/zh-CN/quick-start.md) / [Quick start](../docs/src/content/docs/en/quick-start.md)。单独预览演练界面及所需配置见[前端开发](../docs/src/content/docs/zh-CN/development/frontend.md) / [Frontend development](../docs/src/content/docs/en/development/frontend.md)。

## 实现边界 / Implementation boundary

- 登录、会话续期和退出由 Supabase Auth 处理。受保护的业务路由需要已验证会话；仅本机参考预览可关闭认证。 / Supabase Auth handles sign-in and sessions. Protected workspaces require a verified session; Auth-off is for local reference preview only.
- 数据基座的浏览器请求经 Next.js 服务端转发至 HTTP API；资料原件、项目权限和查询结果由服务端重新核验。 / Data Foundation reads pass through the server-side HTTP API and are reauthorized for each scope.
- 演练场既可在本机展示参考数据，也可读取已授权的运行状态；会话或权限失效时不会自动切换为参考数据。 / EXCON supports local reference data and authorized live reads. A lost live session never switches to reference data.
- 可见文案统一维护在 `src/lib/i18n.ts` 的中英文词典。页面使用共享设计语义、键盘交互、响应式布局与明暗主题。 / Both locale dictionaries own visible copy; the shared design system covers interaction, responsive layout, and themes.

具体身份与交互规则见[统一身份](../docs/src/content/docs/zh-CN/architecture/unified-auth.md)、[产品体验](../docs/src/content/docs/zh-CN/development/product-experience.md)及对应英文页。 / See the matching English [identity](../docs/src/content/docs/en/architecture/unified-auth.md) and [product experience](../docs/src/content/docs/en/development/product-experience.md) guides.

## 验证 / Verify

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
```

仓库交付前还须运行 `pnpm verify` 及 Docpact 检查；需要真实数据库或浏览器环境的检查见[测试与验证](../docs/src/content/docs/zh-CN/development/testing.md) / [Testing and verification](../docs/src/content/docs/en/development/testing.md)。
