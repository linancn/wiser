---
title: Repository structure and dependency boundaries
description: Directory ownership, system packages, shared hosts, dependency direction, and code-placement rules for the WISER monorepo.
docType: architecture
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when deciding where new code, tests, data, or examples belong
  - when changing package dependencies or cross-system calls
whenToUpdate:
  - when workspaces, the system inventory, composition hosts, or dependency direction change
checkPaths:
  - pnpm-workspace.yaml
  - package.json
  - apps/**
  - packages/**
  - infrastructure/**
  - scripts/**
  - supabase/**
  - skills/**
  - examples/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Start with the mental model

WISER is a pnpm monorepo. `apps` contains runnable, deployable composition hosts; `packages` contains reusable contracts, domain code, and infrastructure modules. WISER Platform supplies identity and host conventions. Agent EXCON, Data Foundation, and future systems are peer business systems.

```text
WISER Platform contracts + Auth
                │
        ┌───────┴────────┐
        │                │
  Agent EXCON      Data Foundation      future systems
        └────────┬───────┘
                 │ registered modules
       API / Web / MCP / Docs hosts
```

A shared host does not own business facts. Each system remains responsible for its contracts, core, application use cases, and authoritative data.

## Top-level directories

| Path                          | Responsibility                                                                            | Does not belong here                             |
| ----------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/`                       | Runnable processes and UI: API, Web, Docs, Workers, MCP, and Telemetry Ingress            | Domain rules reused by several hosts             |
| `packages/`                   | Platform and system contracts, pure core, infrastructure, and runtime asset packages      | Page routes and process startup logic            |
| `supabase/`                   | Unified Auth, control plane, and Agent EXCON Supabase schema, migrations, seed, and pgTAP | Data Foundation independent-database migrations  |
| `infrastructure/`             | Compose support, Docker, observability, and Data Foundation database migrations           | Product pages or domain state machines           |
| `scripts/`                    | Repeatable root-level operations, migration, smoke, and stack orchestration               | One-off repairs that require manual intervention |
| `skills/`                     | Agent Skills that use systems through public HTTP/MCP                                     | Direct database access                           |
| `examples/`                   | Runnable demonstrations, cookbooks, and operational examples                              | Production runtime scenario assets               |
| `tests/`                      | Cross-workspace architecture, toolchain, and repository contract tests                    | Unit tests with a clear owning package           |
| `apps/docs/src/content/docs/` | Chinese and English documentation sources for developers and operators                    | Generated site output                            |

Agent EXCON production runtime scenarios live in `packages/excon-scenarios/scenarios/` and are read through the validated `@agent-excon/scenarios` API. Human-facing demonstrations live in `examples/agent-excon/`. Do not recreate root-level `scenarios/` or `cookbooks/` directories.

## Current workspaces

### Shared platform

| Package                     | Responsibility                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `@wiser/platform-contracts` | Public types and schemas for principals, tenants, projects, scopes, purposes, security levels, and request contexts |
| `@wiser/platform-auth`      | Supabase JWT, delegated credentials, authorization context, and PostgreSQL adapters                                 |

### Agent EXCON

| Package or directory     | Responsibility                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------- |
| `@agent-excon/contracts` | External DTOs, commands, events, and protocol schemas                                 |
| `@agent-excon/core`      | Deterministic Scenario, Run, Task, Receipt, Feedback, and adjudication rules          |
| `@agent-excon/infra`     | External AI, PostgreSQL, Supabase, and related adapters                               |
| `@agent-excon/scenarios` | Schema-validated runtime scenarios and testing-fixture API                            |
| `apps/api/src/v2-*`      | Current EXCON v2 application services, durable journal composition, and HTTP adapters |
| `apps/worker`            | PostgreSQL-backed v1 compatibility/testing worker; default API does not enqueue it    |

### Data Foundation

| Package or directory           | Responsibility                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------- |
| `@wiser/data-contracts`        | Capability Registry, catalog, ingestion, operation, and upload protocols                      |
| `@wiser/data-core`             | Pure ingestion, publication, quality, security, and port rules                                |
| `@wiser/data-infra`            | Independent migration runner, object storage, job repository, search, and projection adapters |
| `apps/api/src/data-foundation` | Fastify modules for REST, GraphQL, resources, GIS, and Capabilities                           |
| `apps/data-worker`             | Ingestion, Outbox consumption, and projection runtime                                         |

### Shared hosts

| Application                | Composition responsibility                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `@wiser/api`               | Fastify composition root mounting Platform, Agent EXCON, and Data Foundation modules         |
| `@wiser/web`               | Unified Next.js product shell, system navigation, Supabase Session, localization, and themes |
| `@wiser/mcp`               | stdio/Streamable HTTP gateway that maps system MCP modules to HTTP API calls                 |
| `@wiser/docs`              | Unified Fumadocs documentation site                                                          |
| `@wiser/telemetry-ingress` | Authenticates, rate-limits, sanitizes, and forwards participant OTLP/HTTP telemetry          |

## Dependency direction

The repository architecture contract is written as:

```text
platform contracts <- system contracts <- core <- application <- infra/apps
```

The arrow means the item on the right may depend on the item on the left; the reverse is forbidden. In practice:

1. Platform contracts know nothing about any business system.
2. System contracts may reuse platform principals, scopes, and contexts, but cannot depend on core or adapters.
3. Core may use its own system contracts. It stays pure and deterministic and cannot import databases, HTTP, frameworks, clocks, randomness, filesystems, or AI providers.
4. Application code orchestrates use cases and transactions, depends on contracts/core, and requests external capabilities through ports.
5. Infrastructure and `apps` implement ports, connect databases and networks, and compose dependencies at process entrypoints.

When one system needs another, it may depend only on the other system's public contracts or call its HTTP API at runtime. Importing another system's core, infrastructure, database tables, or projection stores is forbidden. Cross-system references should retain immutable IDs, versions, hashes, and authorization snapshots instead of reading a moving “latest” value during execution.

Browsers, MCP, and Skills all enter through HTTP APIs. They never read PostgreSQL, S3, search indexes, or graph databases directly.

## Deciding where code belongs

| Code                                                                   | Location                                                                           |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Serializable DTOs, public error codes, and input/output schemas        | The system's `*-contracts` package                                                 |
| State transitions, validation, and deterministic decisions without I/O | The system's `*-core` package                                                      |
| Use-case orchestration, transaction boundaries, and port interfaces    | The system's application layer; create a dedicated workspace package when it grows |
| PostgreSQL, S3, HTTP, AI, search, or messaging adapters                | The system's `*-infra` package or a dedicated app adapter                          |
| Fastify routes and runtime dependency injection                        | `apps/api/src/<system>/`                                                           |
| Background loops and health endpoints                                  | `apps/<system>-worker/`                                                            |
| Product pages and server-only DAL                                      | `apps/web/src/app/[locale]/<system>/` and `apps/web/src/lib/`                      |
| MCP Tool/Resource mapping                                              | `apps/mcp/src/<system>/`, calling HTTP only                                        |
| Production runtime static assets                                       | A system-owned workspace package with a validated API                              |
| Tutorials, demonstrations, and cookbooks                               | `examples/<system>/`                                                               |

`src/` and `test/` are the source and test authorities for a package. `dist/`, `.next/`, `.source/`, and generated type files are build outputs. Do not edit them or use them as the code-review entrypoint.

## Focused workspace work

Root commands validate the whole repository. During development, package filters shorten the feedback loop:

```bash
pnpm --filter @wiser/api test
pnpm --filter @wiser/data-core test
pnpm --filter @agent-excon/scenarios typecheck
pnpm --filter @wiser/web test
```

After changing a public contract, also verify every direct consumer. Passing only the contract package's tests does not establish compatibility. Run `pnpm verify` before handoff.

See [backend development](/en/development/backend/) for backend processes and health entrypoints, and [adding a WISER system](/en/development/adding-a-system/) for a new business boundary.
