---
title: Agent EXCON documentation application guide
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
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# Agent EXCON Docs

Next.js 16 + Fumadocs bilingual static documentation. Simplified Chinese is served at the root URL and English under `/en`.

The app declares exact dependency versions in its own `package.json`. Install it from the repository root so the workspace keeps one shared lockfile; do not generate an app-specific lockfile:

```bash
pnpm install
pnpm --filter @agent-excon/docs dev
```

Verification commands:

```bash
pnpm --filter @agent-excon/docs typecheck
pnpm --filter @agent-excon/docs build
pnpm --filter @agent-excon/docs test:e2e
```

Documentation lives in `src/content/docs/zh-CN/` and `src/content/docs/en/`. Every Chinese page must have an English page with the same locale-free slug. `source.config.ts` compiles MDX into the generated `.source/` collection, and `next build` exports the static site into `out/`.
