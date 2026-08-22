---
title: Adding a WISER system
description: Add a third or later business system without breaking unified Auth, shared hosts, or dependency boundaries.
docType: workflow
scope: wiser-platform
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when designing or implementing a business system beyond Agent EXCON and Data Foundation
  - when reviewing the package, Auth, API, UI, documentation, and test completeness of a new system
whenToUpdate:
  - when platform extension points, the system template, unified Auth, UI, or delivery gates change
checkPaths:
  - AGENTS.md
  - package.json
  - pnpm-workspace.yaml
  - compose.yaml
  - .env.example
  - packages/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/*-worker/**
  - apps/docs/**
  - infrastructure/**
  - scripts/**
  - .docpact/**
  - .github/workflows/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Intended use

“Adding a system” means establishing a new business-fact boundary, not adding one page to an existing system. The new system is a peer of Agent EXCON and Data Foundation. It shares WISER Supabase Auth, Fastify, Next.js, MCP, Docs, design system, and observability entrypoints while owning its contracts, core, application use cases, and authoritative data.

If the requirement only extends facts, state machines, or APIs already owned by an existing system, keep it inside that system. Do not manufacture a new system boundary for directory symmetry.

## Before starting: read the platform contracts

Before creating any file, route the existing platform composition points to obtain the authoritative reading set:

```bash
pnpm docpact:route --paths 'AGENTS.md,package.json,apps/api/src/main.ts,apps/web/src/components/app-shell.tsx,apps/mcp/src/index.ts,apps/docs/src/content/docs/en/meta.json,.docpact/config.yaml'
```

Read the returned documents and confirm a new system is justified before drafting the bilingual boundary and first Red. After new paths exist, section 7 reruns route over the actual slice.

## 0. Define the system boundary first

Before coding, create a bilingual architecture page that answers:

- Which authoritative entities, state machines, and audit events does the system own?
- Which facts remain owned by Platform, Agent EXCON, or Data Foundation?
- Are public capabilities REST, GraphQL, MCP, events, or a combination?
- Which operations are deterministic, and where may AI only advise?
- What are the authority store, rebuildable projections, and cross-system references?
- How do Tenant, Project, Purpose, security level, roles, and scopes restrict access?
- Which entrypoint fails closed when the system is disabled, a dependency fails, or a projection lags?

Write the first failing test in terms of public behavior and retain the Red commit. Move toward Green in contracts → core → application → infrastructure/host order.

## 1. Create the package skeleton

Start from this structure. Do not create empty Worker, MCP, or static-asset directories when the system does not need them.

```text
packages/
  <system>-contracts/      # @wiser/<system>-contracts
  <system>-core/           # @wiser/<system>-core
  <system>-application/    # @wiser/<system>-application
  <system>-infra/          # @wiser/<system>-infra
apps/
  api/src/<system>/
  web/src/app/[locale]/<system>/
  mcp/src/<system>/        # only when the system exposes MCP
  <system>-worker/         # only for a real independent process
```

Every package uses root workspace TypeScript, formatting, test, and build conventions, and refers to internal packages with `workspace:*`. Do not duplicate a lockfile, base tsconfig, API host, Web shell, or Docs site.

### Contracts

`@wiser/<system>-contracts` defines serializable public facts:

- input/output DTOs and runtime schemas;
- stable IDs, states, error codes, and Capability/event versions;
- constraints shared by API, MCP, and tests;
- request context and common identifiers from `@wiser/platform-contracts`.

Contracts do not import core, databases, or frameworks and do not expose Fastify requests, ORM rows, or internal secrets. A breaking change requires a new protocol version or an explicit migration path.

### Core

`@wiser/<system>-core` implements state transitions, invariants, deterministic computations, and domain errors. Pass clocks, UUIDs, randomness, AI, files, and networks as explicit inputs or ports. Default tests must return the same output for the same input.

AI may produce candidates, summaries, or classification advice, but it cannot determine scores, authorization, state transitions, or final verdicts. Validate AI output against a contract schema before application code consumes it.

### Application

`@wiser/<system>-application` orchestrates use cases: load aggregates, call core, manage transaction intent, write audit events, and request persistence or external systems through interfaces. It does not import Fastify, Next.js, a concrete database client, or the MCP SDK.

Application code may consume another system's public contracts. When it needs current data from that system, call its public API through an HTTP port. Do not import the other system's core/infrastructure or perform a cross-database join.

### Infrastructure

`@wiser/<system>-infra` implements application ports such as PostgreSQL repositories, object storage, messaging, search, and external HTTP clients. Every adapter needs timeouts, size limits, shape validation, error mapping, and a resource-close path.

## 2. Choose the authority store

Document the authoritative database and migration owner before creating tables:

- For the WISER control plane or a Supabase-managed database, create migrations with the Supabase CLI and keep declarative schema, seed, and pgTAP synchronized.
- If the system needs an independent database, create that system's one checksummed migration runner, advisory lock, and canonical migration directory. Do not mix its history into `supabase/migrations` or reuse Data Foundation migration history.
- Enable RLS on every table in an exposed schema and verify Tenant, Project, ownership, and scope. Checking the `authenticated` role alone is insufficient.
- Put hidden rules, outcomes, jobs, credentials, and idempotency records in private schemas.
- Use explicit transactions, row locks or optimistic versions, unique constraints, and append-only audit events for complex writes.

The system database stores only scoped references to platform subjects, tenants, and projects. It does not copy users, Sessions, memberships, or a second password system.

Use this discoverable structure for an independent database and expose isomorphic lifecycle commands from root `package.json`. Omit steps the system genuinely does not have, but never replace them with manual patches:

```text
infrastructure/<system>/postgres/migrations/  # NNNN_*.sql canonical history
packages/<system>-infra/src/migrations/       # checksum runner + advisory lock
scripts/<system>/                             # up/down/migrate/seed/verify/smoke/reset

pnpm <system>:up
pnpm <system>:migrate
pnpm <system>:seed
pnpm <system>:verify
pnpm <system>:smoke
pnpm <system>:down
<EXACT_SYSTEM_RESET_CONFIRMATION> pnpm <system>:reset
```

Provision separate migration-owner and API roles; create a separate Worker role only when a Worker actually exists. Runtime roles are non-superuser and `NOBYPASSRLS`; reset removes only allowlisted local resources for that system and requires exact confirmation. Prove empty-database replay in disposable CI/development state. If the repository does not yet provide an isolated mode, never run a destructive reset in a workspace whose data must be retained.

## 3. Integrate unified Auth

The new system reuses `@wiser/platform-contracts` and `@wiser/platform-auth`:

1. Use Supabase Sessions for human operations and platform-issued, revocable delegated credentials for Agents and services.
2. Define clearly named scopes such as `<system>.resource.read` and `<system>.resource.manage`, then add them to the known platform scope registry.
3. Resolve a `PlatformRequestContext`, then authorize Tenant, Project, Purpose, role, scope, security ceiling, and ownership.
4. Pass authorization context into application code. A repository does not infer current identity from global environment state.
5. Add negative tests for missing and expired tokens, wrong Tenant/Project, missing scope, security-ceiling violations, and cross-owner access.

The browser never receives a service-role key, database credential, delegated secret, or server-only operator token. Production mode cannot support Auth off.

## 4. Register backend entrypoints

Create runtime config, application adapters, and one or more `WiserApiModule` implementations under `apps/api/src/<system>/`:

- use a unique dotted module ID such as `<system>.catalog`;
- expose REST under `/api/<system>/v1` and fix the version in public contracts;
- reuse the shared error envelope, request ID, CORS, and OpenAPI;
- expose health information that distinguishes liveness from dependency readiness;
- require idempotency keys for writes, with transactions and constraints enforcing retry semantics;
- create the system runtime inside `createDefaultApiApp` and register its modules through `registerWiserApiModules` before `app.ready()`; tests may pass the same module directly to `buildApp`, and module/runtime `onClose` hooks release every external resource;
- use Fastify `inject()` tests for routes, authorization, response schemas, error codes, and no-cache headers.

Do not create a second public HTTP server without a concrete isolation or scaling requirement. An independent Worker performs asynchronous work; business operations still enter through the API.

## 5. Optional Worker, MCP, and Skill

### Worker

Create `apps/<system>-worker` only when jobs require independent claiming, leases, retries, heartbeats, or resource quotas. The Worker uses a restricted database role, stable job types, idempotent handlers, dead-letter/failure states, health endpoints, and graceful shutdown. An in-memory queue is not authoritative state.

### MCP

If Agents need system capabilities, implement a `WiserMcpModule` under `apps/mcp/src/<system>/`:

- reuse system contracts for Tool/Resource schemas;
- call only `/api/<system>/v1`, never the database;
- enforce timeouts, response limits, and shape validation;
- describe idempotency and destructiveness explicitly for write Tools;
- register and test the module in the same stdio and HTTP composition root.

A Skill documents discovery, invocation, recovery, and security workflows. It also uses HTTP/MCP and never embeds service credentials or database paths.

## 6. Integrate the unified frontend

Put system pages under `apps/web/src/app/[locale]/<system>/` and reuse the existing `AppShell`, semantic tokens, components, and theme mechanism.

Complete all of the following:

- add the system to system navigation and preserve consistent movement among Agent EXCON, Data Foundation, and the new system;
- provide identical routes, states, actions, and information hierarchy for `zh-CN` and `en`, with `zh-CN` still the default;
- put all visible copy in both dictionaries in `apps/web/src/lib/i18n.ts` instead of scattering monolingual strings through components;
- use a server-only DAL for Session and internal API addresses; the browser calls only same-origin routes or safe DTOs;
- support light/dark themes, keyboard operation, focus states, responsive layouts, and error/empty/loading states;
- show real unavailable/authorization/contract states on failure instead of falling back to static examples that imply success.

Add Vitest/Playwright coverage for both locale entrypoints, login/authorization failure, the core user task, themes, and keyboard paths.

## 7. Documentation and Docpact

Each system needs at least:

- `architecture/<system>.md` for fact ownership, dependencies, and storage boundaries;
- `protocols/<system>-*.md` for public REST/GraphQL/MCP contracts;
- local configuration, background-process, and test guidance under `development/`;
- system entrypoints in the root README and documentation home;
- semantically isomorphic Chinese and English pages, navigation `meta.json`, and complete Docpact frontmatter.

After paths exist, rerun route over the complete slice every new system must change:

```bash
pnpm docpact:route --paths 'package.json,pnpm-workspace.yaml,.env.example,compose.yaml,README.md,README.en.md,packages/<system>-*/**,packages/platform-contracts/**,packages/platform-auth/**,apps/api/src/<system>/**,apps/api/src/platform/**,apps/api/src/main.ts,apps/web/src/app/*/<system>/**,apps/web/src/components/app-shell.tsx,apps/web/src/lib/i18n.ts,apps/web/e2e/**,apps/docs/src/content/docs/*/index.mdx,apps/docs/src/content/docs/*/architecture/<system>.md,apps/docs/src/content/docs/*/protocols/<system>-*.md,apps/docs/src/content/docs/*/development/*.md,apps/docs/src/content/docs/*/meta.json,.docpact/config.yaml,.github/workflows/**'
```

Then route only optional boundaries that were actually created, such as `apps/mcp/src/<system>/**,apps/mcp/src/index.ts,apps/mcp/src/http-main.ts`, `apps/<system>-worker/**`, `infrastructure/<system>/**`, or `scripts/<system>/**`. Do not include omitted optional directories; investigate and correct every `no-tracked-path-matches` warning.

Run `pnpm docpact:check` before every Red/Green commit so worktree lint cannot lose a committed slice. A new system necessarily extends ownership, coverage, inventory, and rules, so `pnpm docpact:validate` is mandatory; finish with the branch-wide lint below. Do not use a waiver or baseline to hide a new system missing from the documentation graph.

## 8. Completion checklist

| Area        | Required evidence                                                                                         |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| Contracts   | Positive/negative schemas, version compatibility, stable errors, and typechecking consumers               |
| Core        | Pure and deterministic; unit tests cover invariants, state transitions, and boundary values               |
| Application | Tests cover use cases, transactions, idempotency, concurrency, and external-port failures                 |
| Auth        | Supabase/delegated credential, Tenant/Project, scope, ownership, and RLS negative cases                   |
| Database    | Empty migration, repeat migration, constraints, recovery strategy, and non-superuser runtime role         |
| API         | Module registration, OpenAPI, health, error envelope, resource closure, and HTTP contract tests           |
| Worker      | Claim/lease/heartbeat/retry, duplicate delivery, graceful shutdown, and metrics/health                    |
| MCP/Skill   | HTTP only, schema/size/timeout bounds, authorization failure, and transport consistency                   |
| Web         | Isomorphic Chinese/English, Chinese default, both themes, keyboard, responsive, and fail-closed states    |
| Docs        | Bilingual pages, navigation, frontmatter, Docpact routing/coverage, and no duplicate historical narrative |
| Operations  | Compose config, secret boundary, logs, health, smoke, and stop paths                                      |
| CI          | New workspace scripts, database lifecycle, Playwright/smoke, and Docpact are wired into the workflow      |

Every new workspace declares the applicable `typecheck`, `build`, and `test` scripts. Package specs use a root-Vitest-discoverable `*.spec.ts` location. An app with no test script, or a test outside root Vitest collection, is silently skipped by `pnpm verify` and does not count as verified.

Run focused owning tests at every Green checkpoint and add database/browser verification for those surfaces. For handoff, run in this order (remove only genuinely inapplicable optional gates and explain why in review):

```bash
pnpm <system>:verify
pnpm <system>:smoke
pnpm supabase:verify   # if the Supabase-managed schema changed
pnpm data:verify       # if Data Foundation integration changed
pnpm --filter @wiser/web test:e2e   # if the system has Web UI
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
pnpm docpact:check
pnpm docpact:validate
docpact lint --root . --merge-base main --mode enforce --fail-on-uncovered-change --fail-on-stale-docs
pnpm verify            # final repository convergence
```

Keep commits single-purpose: contracts/core, application/API, database, Worker/MCP, UI, and documentation form separate recoverable commits. A system is integrated only when its public vertical slice, negative authorization paths, and operating instructions are all verifiable.
