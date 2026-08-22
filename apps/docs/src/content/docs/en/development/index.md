---
title: Development guide
description: Choose a WISER development path and locate frontend, backend, database, test, and documentation entrypoints.
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - before changing WISER code or documentation
whenToUpdate:
  - when repository layout, development commands, or delivery workflows change
checkPaths:
  - apps/**
  - packages/**
  - infrastructure/**
  - supabase/**
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

## Before you start

From the repository root, enable Corepack and install the frozen dependency graph. The root `package.json` and [Quick start](/en/quick-start/) define supported Node, pnpm, and Docker prerequisites:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Then run Docpact route for the actual target paths before creating or changing files.

## Choose the work type first

| Change                      | Start here                                                              | Primary verification                      |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------- |
| Product UI                  | `apps/web`                                                              | `pnpm --filter @wiser/web test`           |
| Documentation site          | `apps/docs`                                                             | `pnpm --filter @wiser/docs build`         |
| HTTP/GraphQL                | `apps/api`                                                              | `pnpm --filter @wiser/api test`           |
| Agent EXCON domain rules    | `packages/contracts`, `packages/core`                                   | Focused root Vitest plus API/worker tests |
| Data Foundation             | `packages/data-*`, `apps/data-worker`, `infrastructure/data-foundation` | `pnpm data:verify`                        |
| Supabase Auth/control plane | `supabase`, `packages/platform-*`                                       | `pnpm supabase:verify`                    |
| MCP                         | `apps/mcp`                                                              | `pnpm --filter @wiser/mcp test`           |

## Guide directory

| Page                                                                                    | Question answered                                                                                                   |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [Repository structure and dependency boundaries](/en/development/repository-structure/) | Where should code, runtime assets, examples, and tests live?                                                        |
| [Local development environment](/en/development/local-environment/)                     | Should I use the complete stack, base stack, or standalone app, and what are the ports, identities, and stop paths? |
| [Backend development](/en/development/backend/)                                         | How do API, both workers, MCP, and Telemetry Ingress run and verify?                                                |
| [Frontend development](/en/development/frontend/)                                       | What are the Web/Docs route, session, bilingual, theme, and Playwright contracts?                                   |
| [Databases and migrations](/en/development/databases/)                                  | How do Supabase and data-postgres authorities, migrations, RLS, and resets differ?                                  |
| [Testing and verification](/en/development/testing/)                                    | Which Red/Green, focused, database, browser, and smoke gates apply to a change?                                     |
| [Documentation development](/en/development/documentation/)                             | How are READMEs, the docs site, component guides, locales, and Docpact maintained?                                  |
| [Adding a WISER system](/en/development/adding-a-system/)                               | How does a third business system join shared Auth, hosts, UI, docs, and CI?                                         |

## Shared constraints

- Run `pnpm docpact:route --paths '<actual path>'` and read the returned authoritative documents first.
- Use Red → Green → Refactor for behavior changes and retain small Red and Green commits.
- A pure `core` never imports database, HTTP, framework, clock, random, filesystem, or AI-provider code.
- Systems cooperate only through public contracts or HTTP.
- Every product surface preserves isomorphic Chinese/English routes, Chinese default, light/dark themes, keyboard access, and responsive behavior.
- Run `pnpm verify` before handoff; add focused database and browser integration tests when relevant.

Repository `CONTRIBUTING.md` defines contribution rules; root `AGENTS.md` defines the immutable delivery contract for agents.
