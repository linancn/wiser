---
title: Testing and definition of done
description: WISER Red-Green-Refactor loops, root verification scope, focused tests, integration smoke, fake-AI boundary, and completion criteria.
docType: workflow
scope: repository-testing
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when starting a behavior change, selecting verification commands, or preparing a commit
  - when changing databases, browser flows, observability, or Agent exercises
whenToUpdate:
  - when test scripts, CI gates, workspaces, or the definition of done change
checkPaths:
  - package.json
  - vitest.config.ts
  - apps/*/package.json
  - apps/*/vitest.config.ts
  - apps/*/playwright.config.ts
  - scripts/data-foundation/**
  - infrastructure/observability/**
  - examples/agent-excon/**
  - .github/workflows/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Red → Green → Refactor

A behavior change starts with a failing test that describes a user outcome, protocol guarantee, or domain invariant.

1. **Red:** write the smallest failing test, run it, and confirm it fails because the intended behavior is absent rather than because of a fixture, environment, or spelling error.
2. **Green:** implement the smallest change that passes the test, then run regressions at the same boundary.
3. **Refactor:** improve naming, duplication, and dependency direction while tests remain green and observable behavior stays unchanged.
4. **Integrate:** run the real database, browser, observability, or vertical smoke required by the change type.
5. **Document and commit:** update Chinese/English docs, run worktree Docpact before every commit and branch-wide lint against the merge base before handoff, and retain small recoverable Red/Green commits.

Tests should prefer public functions, HTTP, GraphQL, MCP, database policies, or visible UI. Do not substitute private-call counts for business outcomes. Reproduce a production defect with a regression test before fixing it.

## Test layers

| Layer                     | Primary proof                                                                             | Default tool                                          |
| ------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Pure domain and contracts | State transitions, scores, schemas, error codes, determinism                              | Vitest                                                |
| Application component     | Fastify routes, identity resolution, idempotency, adapter collaboration                   | Vitest + Fastify `inject()`                           |
| Database integration      | Migrations, constraints, RLS, runtime roles, locks, and transaction atomicity             | Local Supabase / Compose PostgreSQL                   |
| Browser                   | Chinese default, isomorphic English, themes, keyboard, responsiveness, and critical flows | Playwright Chromium                                   |
| Vertical smoke            | Real Auth, API, Worker, persistence, projections, MCP, and Web composition                | Repository operations scripts                         |
| Agent exercise            | Multiple RunAgents, Receipts, Barriers, revisions, and deterministic evaluation           | Scripted/rework cookbook                              |
| Online AI                 | Provider credentials and minimal call availability                                        | Explicit opt-in only; never a default test or CI gate |

## What `pnpm verify` actually covers

Run from the repository root:

```bash
pnpm verify
```

It performs, in order:

1. `prettier --check .` across the repository;
2. Fumadocs content generation followed by type-aware Oxlint;
3. TypeScript checks for every workspace that declares `typecheck`;
4. root Vitest over `packages/**/*.spec.ts` and `tests/**/*.spec.ts`, followed by every existing `test` script under `apps/*`;
5. builds for every workspace that declares `build`;
6. `docker compose config --quiet` for the default Compose configuration.

`pnpm verify` does not start Docker services, reset or test Supabase, apply Data migrations, run `data:smoke`, or include Web/Docs Playwright, observability smoke, cookbooks, showcases, or any real AI call. Add the focused gates below whenever the change requires them.

## Focused Vitest and workspace commands

Use the narrowest command during development, then return to root verification before completion.

| Scope                            | Command                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| One root or package spec         | `pnpm exec vitest run <path-to-spec>`                                                 |
| Agent EXCON contracts/core/infra | `pnpm exec vitest run packages/contracts/test packages/core/test packages/infra/test` |
| Platform contracts/auth          | `pnpm exec vitest run packages/platform-contracts/test packages/platform-auth/test`   |
| API composition                  | `pnpm --filter @wiser/api test`                                                       |
| EXCON v1 compatibility Worker    | `pnpm --filter @agent-excon/worker test`                                              |
| Data Worker                      | `pnpm --filter @wiser/data-worker test`                                               |
| MCP composition                  | `pnpm --filter @wiser/mcp test`                                                       |
| Telemetry Ingress                | `pnpm --filter @wiser/telemetry-ingress test`                                         |
| Web unit/read model              | `pnpm --filter @wiser/web test`                                                       |
| Data contracts                   | `pnpm --filter @wiser/data-contracts test`                                            |
| Data core                        | `pnpm --filter @wiser/data-core test`                                                 |
| Data infrastructure              | `pnpm --filter @wiser/data-infra test`                                                |
| EXCON scenario assets            | `pnpm --filter @agent-excon/scenarios test`                                           |

`@agent-excon/contracts`, `@agent-excon/core`, `@agent-excon/infra`, `@wiser/platform-contracts`, and `@wiser/platform-auth` have no standalone `test` script. Their specs are collected by root Vitest, so use the path commands in the table. Do not mistake a no-script result from `pnpm --filter <package> test` for an executed test suite.

## Supabase and Data Foundation

For Supabase schema, RLS, seed, or platform/EXCON database logic changes:

```bash
pnpm supabase:start
pnpm supabase:verify
pnpm supabase:stop
```

`supabase:verify` resets local Supabase before running pgTAP, lint, and advisors. Back up any local data that must be retained.

For Data package, migration-runner, or Compose contract changes, first run:

```bash
pnpm data:verify
```

It does not touch a running database. Changes to Data schemas, runtime roles, Workers, object storage, projections, REST, GraphQL, MCP, or authenticated Web also require the live vertical path:

```bash
pnpm supabase:start
pnpm supabase:reset
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
pnpm data:down
pnpm supabase:stop
```

On a clean environment, `pnpm stack:full:up` converges Supabase startup, the Data profile, migrations, seed, and `data:smoke`. A passing smoke proves the fixed sequence across upload, scanning, fingerprinting, fake Agent, deterministic transformation, quality/review, authority commit, Outbox, five completion targets, REST, GraphQL, MCP, and authenticated Web. It also verifies that Outbox replay does not duplicate target facts.

## Playwright

```bash
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs test:e2e
```

Both Playwright configurations start their own development servers: Web uses `127.0.0.1:3100`, while Docs uses `127.0.0.1:4321`. These tests prove browser routing, language, theme, and interaction. Unless a test explicitly connects to the complete stack, they do not replace unified-Auth or database vertical smoke.

Every visible UI change covers Chinese-default and equivalent English states, and checks light/dark themes, keyboard focus, narrow screens, and failure/unavailable states. When repairing locators, prefer roles, labels, visible text, or stable test ids.

## Observability

When changing OTLP ingress, collectors, trace/metric/log pipelines, Grafana data sources, or redaction behavior, run:

```bash
pnpm observability:config
pnpm observability:up
pnpm observability:smoke
pnpm observability:down
```

The smoke checks real OTLP traces, metrics, logs, and sensitive-field redaction. It validates the best-effort diagnostics plane; complete telemetry still cannot replace Events, Receipts, evaluations, or database audit facts.

## Cookbooks, showcase, and other smoke

For Agent EXCON scenario, MCP participant flow, Barrier, evaluation, or exercise-runner changes, run both model-free paths:

```bash
pnpm cookbook:scripted
pnpm cookbook:rework
pnpm showcase:preflight
```

`cookbook:scripted` proves four scripted RunAgents complete the case through real MCP/API. `cookbook:rework` first injects a schema error, then proves the scoped grant, revision 2, and final evaluation. `showcase:preflight` validates prerequisites only; it does not prove that a showcase session ran successfully.

The real WorkBuddy path incurs model usage and requires network access, login, and explicit current-user authorization:

```bash
WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy
```

It is not a default gate and must never run automatically for an ordinary code change. The complete Data smoke is `pnpm data:smoke`; the observability smoke is `pnpm observability:smoke`. Do not treat one `/health/ready` response as a passing vertical smoke.

## AI and deterministic boundaries

- Tests, CI, scripted cookbooks, and Data smoke use a fake provider or deterministic fake embedding, with no network access or model cost.
- Fake output still passes through the same schemas and business gates as production adapters.
- AI never generates deterministic scores, authorization decisions, quality conclusions, acceptance, or publication verdicts. Pure rules and tests fix those behaviors.
- The local Codex provider is enabled explicitly on a trusted host only; authentication files never enter containers.
- OpenAI-compatible or WorkBuddy online smoke is always explicit opt-in. Report failures faithfully; do not hide retries or silently downgrade them into a “success.”

## When to run each gate

| Change type                    | Minimum development loop           | Add before merge                                          |
| ------------------------------ | ---------------------------------- | --------------------------------------------------------- |
| Contracts / core               | One spec or package path           | `pnpm verify`                                             |
| API / Worker / MCP             | Corresponding workspace `test`     | `pnpm verify`; add the relevant smoke for real storage    |
| Web / Docs UI                  | Web unit test or Docs build        | Corresponding Playwright + `pnpm verify`                  |
| Supabase schema/RLS/seed       | pgTAP Red + `pnpm supabase:verify` | `pnpm verify`                                             |
| Data schema/runtime/projection | Focused spec + `pnpm data:verify`  | Complete Data sequence or `stack:full:up` + `pnpm verify` |
| Observability                  | Focused Vitest                     | config/up/smoke/down + `pnpm verify`                      |
| EXCON scenario/cookbook        | Focused root spec                  | scripted + rework + `pnpm verify`                         |
| Documentation governance       | Docs build + `pnpm docpact:check`  | Docs Playwright + `pnpm verify`                           |

## Definition of done

Before a change is ready to hand off:

- The new test failed for the expected reason and now passes; existing regressions remain green.
- Negative cases cover authorization, invalid input, concurrency, idempotency, and unavailable states in proportion to risk.
- Core remains pure and deterministic; cross-system calls use public contracts or HTTP only.
- Database migrations replay from an empty local database; RLS is exercised through non-superuser roles, and seeds stay synchronized with declarative schemas.
- Visible UI copy exists in both languages, with theme, keyboard, and responsive behavior verified.
- Default tests have no real model call, external cost, or secret dependency.
- After coding, `pnpm docpact:check` has run and matched authoritative docs are updated or have genuine review evidence.
- A multi-commit branch runs `docpact lint --root . --merge-base <base-ref> --mode enforce --fail-on-uncovered-change --fail-on-stale-docs` so committed Red/Green slices are included.
- Required focused gates, integration smoke, and final `pnpm verify` all pass.
- The Git diff contains only intended scope and passes `git diff --check`; Red is a recoverable checkpoint, while the final commit is Green and single-purpose.
