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
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

# WISER Docs / 文档站

`apps/docs` 是 WISER 的中英文文档站。它从使用任务引导读者查阅数据、加入智能体演练、连接外部客户端或在本机开发；架构和协议页保留可供开发者与 AI 核对的精确边界。 / `apps/docs` is the bilingual WISER documentation site. It starts with user tasks and keeps precise architecture and protocol references for developers and AI readers.

## 阅读入口 / Reading paths

- [中文首页](./src/content/docs/zh-CN/index.mdx) / [English home](./src/content/docs/en/index.mdx)：选择系统和任务。
- [现网资料使用指南](./src/content/docs/zh-CN/development/wiser-data-guide.md) / [Public data guide](./src/content/docs/en/development/wiser-data-guide.md)：查阅资料、试验接入和外部客户端连接状态。
- [快速开始](./src/content/docs/zh-CN/quick-start.md) / [Quick start](./src/content/docs/en/quick-start.md)：本机完整体验。
- [开发手册](./src/content/docs/zh-CN/development/index.md) / [Development guide](./src/content/docs/en/development/index.md)：开发、验证与维护。
- [数据接口](./src/content/docs/zh-CN/protocols/data-rest.md) / [Data REST](./src/content/docs/en/protocols/data-rest.md)：从可调用接口进入 HTTP、GraphQL 与 MCP 协议说明。

首页和文档页提供双语智能体设置复制入口；生产构建使用公开的 `WISER_AGENT_SETUP_URL` 指向当前接入说明。复制不授予访问权限。 / The bilingual agent setup action points to the current public setup instructions through `WISER_AGENT_SETUP_URL`; copying does not grant access.

## 运行与维护 / Run and maintain

从仓库根目录运行： / From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm --filter @wiser/docs dev
```

本机入口为 `http://127.0.0.1:4321/`（中文）和 `http://127.0.0.1:4321/en/`（英文）。源文件在 `src/content/docs/{zh-CN,en}/`，目录顺序由同级 `meta.json` 控制。两种语言共享路径、功能、状态和操作。 / The source lives under `src/content/docs/{zh-CN,en}/`; each directory's `meta.json` controls navigation. Both languages preserve routes and meaning.

当前架构与可运行工作流属于文档站；过期计划和里程碑记录留在 Git 或议题中。依赖版本以清单、锁文件和容器配置为准。每页需要完整 Docpact frontmatter，并与同语言导航及另一语言页面同步。 / Keep current architecture and runnable workflows here, historical plans in Git or issues, versions in manifests, and both locales aligned.

## 验证 / Verify

```bash
pnpm --filter @wiser/docs typecheck
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
```

仓库交付检查见[测试与验证](./src/content/docs/zh-CN/development/testing.md) / [Testing and verification](./src/content/docs/en/development/testing.md)。
