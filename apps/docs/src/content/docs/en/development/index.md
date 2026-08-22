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

## Choose the work type first

| Change                      | Start here                            | Primary verification                      |
| --------------------------- | ------------------------------------- | ----------------------------------------- |
| Product UI                  | `apps/web`                            | `pnpm --filter @wiser/web test`           |
| Documentation site          | `apps/docs`                           | `pnpm --filter @wiser/docs build`         |
| HTTP/GraphQL                | `apps/api`                            | `pnpm --filter @wiser/api test`           |
| Agent EXCON domain rules    | `packages/contracts`, `packages/core` | Focused root Vitest plus API/worker tests |
| Data Foundation             | `packages/data-*`, `apps/data-worker` | `pnpm data:verify`                        |
| Supabase Auth/control plane | `supabase`, `packages/platform-*`     | `pnpm supabase:verify`                    |
| MCP                         | `apps/mcp`                            | `pnpm --filter @wiser/mcp test`           |

## Shared constraints

- Run `pnpm docpact:route --paths '<actual path>'` and read the returned authoritative documents first.
- Use Red → Green → Refactor for behavior changes and retain small Red and Green commits.
- A pure `core` never imports database, HTTP, framework, clock, random, filesystem, or AI-provider code.
- Systems cooperate only through public contracts or HTTP.
- Every product surface preserves isomorphic Chinese/English routes, Chinese default, light/dark themes, keyboard access, and responsive behavior.
- Run `pnpm verify` before handoff; add focused database and browser integration tests when relevant.

See the [local development environment](/en/development/local-environment/) for runtime modes, ports, and environment variables. Repository `CONTRIBUTING.md` defines commit and documentation-governance rules.
