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
  - apps/*/playwright.*.config.ts
  - apps/*/e2e*/**
  - scripts/data-foundation/**
  - infrastructure/observability/**
  - examples/agent-excon/**
  - .github/workflows/**
lastReviewedAt: 2026-08-23
lastReviewedCommit: 5e253f1123d2b2b625077ac9544a34378e8d64b2
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
4. `pnpm test:unit`, which uses one Vitest projects run: app projects may run in parallel, while the root project named `repository` serializes `packages/**/*.spec.ts` and `tests/**/*.spec.ts`;
5. `pnpm test:ops`, which uses the Node test runner over `scripts/data-foundation/*.test.mjs` to verify operations orchestration, runtime roles, Supabase status parsing, and the vertical-smoke contract;
6. builds for every workspace that declares `build`;
7. `docker compose config --quiet` for the default Compose configuration.

`pnpm verify` does not start Docker services, reset or test Supabase, apply Data migrations, run `data:smoke`, or include Web/Docs Playwright, observability smoke, cookbooks, showcases, or any real AI call. Add the focused gates below whenever the change requires them.

## Focused Vitest and workspace commands

Use the narrowest command during development, then return to root verification before completion.

| Scope                            | Command                                                                               |
| -------------------------------- | ------------------------------------------------------------------------------------- |
| One root or package spec         | `pnpm exec vitest run <path-to-spec>`                                                 |
| Complete unit coverage           | `pnpm test:coverage`                                                                  |
| Data Foundation operations       | `pnpm test:ops`                                                                       |
| Agent EXCON contracts/core/infra | `pnpm exec vitest run packages/contracts/test packages/core/test packages/infra/test` |
| Platform contracts/auth          | `pnpm exec vitest run packages/platform-contracts/test packages/platform-auth/test`   |
| API composition                  | `pnpm --filter @wiser/api test`                                                       |
| Agent EXCON durable journal      | `pnpm test:postgres:excon-v2`                                                         |
| EXCON v1 compatibility Worker    | `pnpm --filter @agent-excon/worker test`                                              |
| Data Worker                      | `pnpm --filter @wiser/data-worker test`                                               |
| MCP composition                  | `pnpm --filter @wiser/mcp test`                                                       |
| Telemetry Ingress                | `pnpm --filter @wiser/telemetry-ingress test`                                         |
| Web unit/read model              | `pnpm --filter @wiser/web test`                                                       |
| Data contracts                   | `pnpm --filter @wiser/data-contracts test`                                            |
| Data core                        | `pnpm --filter @wiser/data-core test`                                                 |
| Data infrastructure              | `pnpm --filter @wiser/data-infra test`                                                |
| EXCON scenario assets            | `pnpm --filter @agent-excon/scenarios test`                                           |

`pnpm test` explicitly composes `test:unit` and `test:ops`. `@agent-excon/contracts`, `@agent-excon/core`, `@agent-excon/infra`, `@wiser/platform-contracts`, and `@wiser/platform-auth` have no standalone `test` script. Their specs are collected by the `repository` project, so use the path commands in the table. Do not mistake a no-script result from `pnpm --filter <package> test` for an executed test suite.

## Coverage

```bash
pnpm test:coverage
```

This command merges packages and every app with a unit suite in one Vitest projects run, explicitly includes TypeScript/TSX source files that no test imported, and emits text, `coverage/lcov.info`, and `coverage/coverage-summary.json`. Docs remains build/Playwright-gated and is outside unit coverage. Long-running process bootstrap files are explicitly excluded; CLIs, barrels, and Web pages remain visible in the report.

The verified coverage ratchet enforces global floors of 73% statements, 67% branches, 75% functions, and 76% lines. Higher scoped floors protect pure Core v2, its shared deterministic helpers, the OTLP Collector forwarder, and Graph/STAC/PostGIS input validation. CI runs this command after `pnpm verify` and retains LCOV plus the JSON summary for seven days. Thresholds never auto-update: a future increase is an explicit reviewed change based on a fresh Green report.

These figures measure only the Vitest manifest. Playwright, pgTAP, real PostgreSQL integration, operations smoke, and browser-visible Next.js pages remain separate proof layers and are not merged into the unit percentage. Do not lower a threshold merely to accommodate untested code or interpret the global number as product-level coverage.

## Supabase and Data Foundation

For Supabase schema, RLS, seed, or platform/EXCON database logic changes:

```bash
pnpm supabase:start
pnpm supabase:verify
pnpm supabase:stop
```

`supabase:verify` resets local Supabase before running pgTAP, lint, and advisors. Back up any local data that must be retained.

The Agent EXCON journal deep suite runs only against a verified local Supabase PostgreSQL server and requires an explicit loopback administrator URL:

```bash
EXCON_JOURNAL_TEST_ADMIN_URL='<loopback-admin-dsn>' pnpm test:postgres:excon-v2
```

The suite never resets the shared `postgres` database. Each of its seven serial cases creates one exact ephemeral database and login role, applies the canonical journal migration, exercises the production runtime, closes every service and pool, and drops only those tracked objects. It proves least-privilege restart/replay, pending-outcome recovery, one-writer locking, result drift, intent corruption, historical HMAC-key loss, and rejection of runtime roles with RLS-bypass, database/role-creation, or replication capability. CI runs it after `supabase:verify` and before the unconditional Supabase stop step.

For Data package, migration-runner, or Compose contract changes, first run:

```bash
pnpm data:verify
```

`data:verify` reuses the root `test:ops` entrypoint, then checks the four Data workspaces' test/typecheck/build and Compose configuration; it does not touch a running database. Changes to Data schemas, runtime roles, Workers, object storage, projections, REST, GraphQL, MCP, or authenticated Web also require the live vertical path:

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

The two real PostgreSQL adapter gates may target only CI or an explicitly disposable isolated Data database. The API gate runs both command and PostGIS query specs and needs a migration-owner DSN so it can create temporary non-bypass roles; the Worker gate logs in as the real `wiser_data_worker` and commits randomized authority fixtures:

```bash
WISER_DATA_PG_INTEGRATION=1 DATA_TEST_DATABASE_URL='<owner-dsn>' pnpm test:postgres:data-api
DATA_WORKER_PG_SMOKE_URL='<worker-dsn>' pnpm test:postgres:data-worker
```

The API command spec uses a temporary non-bypass role to prove illegal Operation, Ingestion, Job, and Transform Plan transitions fail with stable PostgreSQL errors. It also proves authority identity/content, terminal and running same-state protection, capability-scoped upload completion, exact row versions, retirement of the legacy claim path, accurate wake-to-claim event history, and legal heartbeat/wait aggregation. Its positive fixture advances through the legal lifecycle rather than inserting an impossible intermediate state. The API PostGIS spec separately proves authoritative latest/exact immutable-version selection, preservation of sibling extents, DataItem intersection, and fail-closed Tenant, security, and policy boundaries. The Worker deep test then proves the guarded schema still accepts the complete ingestion commit path.

Data Foundation CI completes the vertical smoke and saves its machine-readable report first, runs the authenticated Data browser suite against that same stack, then runs the API and Worker deep tests, and finally removes that job's Data volumes unconditionally. The order is `smoke → authenticated browser → API/Worker deep tests → always cleanup`; cleanup must still run after any earlier failure. Never point these commands at a shared database or a local volume whose data must be retained.

On a clean environment, `pnpm stack:full:up` converges Supabase startup, the Data profile, migrations, seed, and `data:smoke`. A passing smoke proves the fixed sequence across upload, scanning, fingerprinting, fake Agent, deterministic transformation, quality/review, authority commit, Outbox, five completion targets, REST, GraphQL, MCP, and authenticated Web. It also verifies that Outbox replay does not duplicate target facts.

## Playwright

Run both reference browser suites together:

```bash
pnpm test:e2e:reference
```

Or run only the affected application:

```bash
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs test:e2e
```

Both Playwright configurations start isolated development servers: Web uses `127.0.0.1:3100`, while Docs uses `127.0.0.1:4322`. The CI browser job runs the same root command after `pnpm verify` and retains screenshots, traces, and the HTML report only on failure. The standard suites use reference/Auth-off configuration to prove browser routing, language, theme, and interaction; they do not replace unified-Auth or database vertical smoke.

### Authenticated Data live suite

After a disposable loopback stack has already completed Data migration, seed, and smoke, run the protected browser flow against that same stack:

```bash
WISER_WEB_LIVE_BASE_URL='http://127.0.0.1:3000' \
WISER_WEB_LIVE_SMOKE_REPORT='<absolute-path-to-successful-smoke-report.json>' \
WISER_WEB_LIVE_EMAIL='<seeded-local-email>' \
WISER_WEB_LIVE_PASSWORD='<seeded-local-password>' \
pnpm test:e2e:data-live
```

| Variable                      | Contract                                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `WISER_WEB_LIVE_BASE_URL`     | Loopback origin of the already-running Web application; shared, staging, and production origins are forbidden. |
| `WISER_WEB_LIVE_SMOKE_REPORT` | Absolute path to the successful machine-readable `data:smoke` report produced by this same stack.              |
| `WISER_WEB_LIVE_EMAIL`        | Seeded local fixture identity used through the sign-in UI.                                                     |
| `WISER_WEB_LIVE_PASSWORD`     | Password for that local fixture identity; never print or persist it in diagnostics.                            |

This command is a test consumer, not a stack orchestrator: it does not start or stop services, apply migrations or seed, run smoke, or reset any authority. It must reuse an already migrated, seeded, smoke-verified loopback stack whose data and volumes are disposable. Unlike the reference/Auth-off suite, it signs in through a real Supabase session and verifies protected Data Web/API behavior; a passing reference suite cannot satisfy this identity boundary.

The live Playwright configuration disables traces and video and captures screenshots only on failure. CI may upload the failed-run screenshots and live HTML report, with restricted access and short retention; it must not publish the four environment values, auth cookies or storage state, request headers, DSNs, the smoke report, service logs, or downloaded user content. Treat even the permitted failure diagnostics as sensitive before sharing them outside the CI run.

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
