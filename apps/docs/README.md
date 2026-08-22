---
title: WISER documentation application guide
docType: component-guide
scope: apps/docs
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing or running the bilingual documentation application
whenToUpdate:
  - when the docs runtime, build, locale, or verification workflow changes
checkPaths:
  - apps/docs/src/app/**
  - apps/docs/src/components/**
  - apps/docs/src/lib/**
  - apps/docs/source.config.ts
lastReviewedAt: 2026-08-22
lastReviewedCommit: fe6687b78bae4241b59c82280f4a97b2fcff05d3
---

# WISER Docs

Next.js 16 + Fumadocs is the single bilingual documentation application for WISER Platform, Agent EXCON, Data Foundation, and future systems. Simplified Chinese is served at the root URL and English under `/en`. Architecture and protocol navigation includes shared platform/Auth/design contracts plus separate Agent EXCON HTTP/MCP and Data REST/GraphQL/MCP references.

The app declares exact dependency versions in its own `package.json`. Install it from the repository root so the workspace keeps one shared lockfile; do not generate an app-specific lockfile:

```bash
pnpm install --frozen-lockfile
pnpm --filter @wiser/docs dev
```

Verification commands:

```bash
pnpm --filter @wiser/docs typecheck
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
```

Documentation lives in `src/content/docs/zh-CN/` and `src/content/docs/en/`. Every Chinese page must have an English page with the same locale-free slug. `source.config.ts` compiles MDX into the generated `.source/` collection, and `next build` exports the static site into `out/`.
