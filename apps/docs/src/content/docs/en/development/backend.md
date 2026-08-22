---
title: Backend development
description: Source entrypoints and focused workflows for the shared Fastify API, EXCON v1 compatibility Worker, Data Worker, MCP, and Telemetry Ingress.
docType: runbook
scope: wiser-backend
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing WISER backend routes, application services, Workers, MCP, or telemetry entrypoints
  - when selecting focused backend tests and health checks
whenToUpdate:
  - when backend processes, module registration, route prefixes, ports, or workspace commands change
checkPaths:
  - apps/api/**
  - apps/worker/**
  - apps/data-worker/**
  - apps/mcp/**
  - apps/telemetry-ingress/**
  - packages/**
  - compose.yaml
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Backend topology

WISER does not duplicate a public API for every system. Platform, Agent EXCON, and Data Foundation compose into one Fastify process. Long-running work, MCP, and participant telemetry use separate processes.

```text
Web / external clients / Skills
              │
              ▼
       @wiser/api :3001
       ├── /api/platform/v1   unified identity and delegation
       ├── /api/v2            Agent EXCON
       ├── /api/data/v1       Data Foundation REST/resources/GIS
       └── /graphql           Data Foundation GraphQL
              │
       ┌──────┼─────────────┐
       ▼      ▼             ▼
 EXCON Worker Data Worker  authority stores

MCP gateway ──HTTP────────► @wiser/api
Telemetry Ingress ────────► internal OTel Collector
```

## Processes and source entrypoints

| Process                       | Entrypoint                           | Focused start                                      | Local entrypoint and health                                                 |
| ----------------------------- | ------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| Shared API `@wiser/api`       | `apps/api/src/main.ts`, `app.ts`     | `pnpm --filter @wiser/api dev`                     | Defaults to `3001`; `/health/live`, `/health/ready`, `/openapi.json`        |
| EXCON v1 compatibility Worker | `apps/worker/src/main.ts`            | `pnpm --filter @agent-excon/worker dev`            | Health defaults `8081`, Compose `3002`; default API does not enqueue        |
| Data Worker                   | `apps/data-worker/src/main.ts`       | `pnpm --filter @wiser/data-worker dev`             | `/health/live`, `/health/ready`, `/metrics`; complete stack maps `13003`    |
| MCP stdio                     | `apps/mcp/src/index.ts`              | Build first, then `pnpm --filter @wiser/mcp start` | stdio; no HTTP port                                                         |
| MCP HTTP                      | `apps/mcp/src/http-main.ts`          | `pnpm --filter @wiser/mcp dev:http`                | `/mcp`, `/health/live`, `/health/ready`; complete stack maps `13004`        |
| Telemetry Ingress             | `apps/telemetry-ingress/src/main.ts` | `pnpm --filter @wiser/telemetry-ingress dev`       | `/v1/traces`, `/v1/metrics`, `/v1/logs`; observability profile maps `14318` |

Complete-stack addresses in this table are Compose mappings; standalone process defaults may differ. When the work needs the same identity, databases, and dependencies as the complete platform, use `pnpm stack:full:up` instead of assembling environment variables manually. See the [local development environment](/en/development/local-environment/) for every port and stop command.

## Shared Fastify API

### Composition order

`apps/api/src/main.ts` is the production entrypoint:

1. `createV2RuntimeFromEnvironment` creates the Agent EXCON v2 in-memory or PostgreSQL-journal runtime.
2. `createPlatformAuthRuntimeFromEnvironment` creates the unified Platform credential resolver and platform modules.
3. `buildApp` registers the common error envelope, CORS, OpenAPI, health endpoints, EXCON v1 compatibility, and `/api/v2`.
4. `createDataFoundationRuntimeFromEnvironment` creates Data adapters, and `registerWiserApiModules` mounts their modules.
5. Fastify `onClose` hooks close database pools, object-store clients, and other resources.

Business modules implement `WiserApiModule`. A module ID must be a unique, dotted lowercase name such as `data.foundation`. A module registers routes inside its own scope instead of bypassing the composition root with a second public API.

### Route ownership

| Route                | Owner                                               | Primary source                                              |
| -------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| `/api/platform/v1/*` | WISER Platform                                      | `apps/api/src/platform/`                                    |
| `/api/v2/*`          | Agent EXCON v2                                      | `apps/api/src/v2-routes.ts` and `v2-*` application services |
| `/api/v1/*`          | Agent EXCON v1 compatibility                        | `apps/api/src/app.ts`; local in-memory compatibility only   |
| `/api/data/v1/*`     | Data Foundation REST, Capability, Resource, and GIS | `apps/api/src/data-foundation/`                             |
| `/graphql`           | Data Foundation schema-first GraphQL                | `apps/api/src/data-foundation/graphql-module.ts`            |

`/health/ready` checks the API's own EXCON services. Data Foundation has a separate `/api/data/v1/health` that reports database, object-store, and Data Worker status. Do not treat one liveness response as proof that every dependency is ready.

### Identity and runtime modes

- Supabase Auth is the only human Session authority. The platform resolver also accepts authorized delegated credentials.
- Production forces `WISER_AUTH_MODE=supabase`. Non-production may explicitly use `off`, but Data Foundation refuses to start while Auth is off.
- A Platform request context contains Tenant, Project, Purpose, roles, scopes, security ceiling, and authz version. A system adapter authorizes from that context; “logged in” alone is not sufficient.
- Agent EXCON maps Platform roles to operator/run_agent, and a run_agent credential must also be bound to the concrete RunAgent.
- Browser-visible configuration contains only publishable Supabase values. Database DSNs, operator credentials, S3 keys, HMAC keys, and MCP tokens remain server-side.

Treat `.env.example`, the runtime config loaders, and `compose.yaml` as the configuration sources. Do not add a second identity table or an implicit fallback token in documentation or code.

## Workers

### Agent EXCON v1 compatibility Worker

`apps/worker` consumes `excon_private.evaluation_jobs`, reads v1 `episodes/submissions`, and performs deterministic evaluation. Default API v1 is an in-process memory service, while v2 evaluates inside the API service/journal replay; neither enqueues this Worker. It therefore serves only PostgreSQL-backed v1 compatibility/testing. `DATABASE_URL` is required; claim size, lease, polling, and health use `WORKER_*`.

When changing evaluation input, inspect all of these together:

- deterministic rules in `@agent-excon/core`;
- the safe input projection in `apps/worker/src/evaluation-input.ts`;
- claim and lease semantics in the PostgreSQL repository;
- API reads of evaluation status.

### Data Worker

`apps/data-worker` composes controlled-ingestion handlers and authority-Outbox completion targets. `POSTGIS` establishes governed spatial readiness inside data-postgres; Weaviate, OpenSearch, Neo4j, and STAC are rebuildable external projections. The Worker accesses independent Data PostgreSQL through a restricted runtime role and uses object-store/internal-service adapters.

`apps/data-worker/src/config.ts` validates its configuration strictly. Prefer canonical `DATA_*` names. Compatibility aliases exist only for migration and produce a startup warning. The Worker's `/metrics` response is Prometheus text, not a business source of truth.

## MCP gateway

`@wiser/mcp` provides both stdio and stateless Streamable HTTP transports. System capabilities register through `WiserMcpModule`; both current EXCON and Data modules call `@wiser/api` through bounded HTTP clients.

Preserve these boundaries:

- Tool and Resource schemas come from public system contracts, and outputs are size- and shape-validated.
- MCP does not import API application services or query databases, journals, or projections.
- The HTTP transport's `/mcp` requires its own bearer token; downstream API requests still use each system's authorized credential.
- A new module has a unique dotted ID and composes through `registerWiserMcpModules`.

## Telemetry Ingress

`@wiser/telemetry-ingress` accepts only OTLP JSON traces, metrics, and logs. It verifies a participant telemetry credential, overwrites protected self-reported identity attributes, rejects sensitive prompt, completion, Tool-body, and hidden-outcome fields, and then forwards the payload to the internal Collector.

Local demo mode may explicitly configure a long random local token and Run/RunAgent IDs. Other modes require the PostgreSQL credential verifier and a token pepper. The Collector is not a trusted public entrypoint for external Agents, and telemetry cannot replace Domain Events, Receipts, or audit facts.

## One focused backend loop

1. Write a failing test around public behavior. Put pure rules in core tests, routes in Fastify `inject()` tests, Workers behind fake ports, and MCP behind a fake HTTP client.
2. If the protocol changes, update system contracts and compatibility tests before application code and adapters.
3. Return stable domain outcomes from the application layer; map status codes, error envelopes, and actionable guidance at Fastify/MCP boundaries.
4. Use idempotency keys, transactions, unique constraints, and concurrency control for writes. An in-process lock does not prove database semantics.
5. Run the owning workspace tests first, direct consumers next, and repository verification last.

Common focused commands:

```bash
pnpm --filter @wiser/api test
pnpm --filter @agent-excon/worker test
pnpm --filter @wiser/data-worker test
pnpm --filter @wiser/mcp test
pnpm --filter @wiser/telemetry-ingress test

pnpm --filter @wiser/api typecheck
pnpm --filter @wiser/api build
```

Add gates according to the authority that changed; do not run both database suites unconditionally:

```bash
pnpm supabase:verify  # Supabase Auth/control/EXCON schema, RLS, seed only; resets local Supabase
pnpm data:verify      # Data contracts/core/infra/Worker/Compose static and workspace checks
pnpm data:smoke       # real Data database/object/projection/API/MCP/Web slice; needs running dependencies
pnpm verify           # repository convergence after required focused and integration gates
```

A pure EXCON protocol change normally needs no Data gate, and a pure Data change should not erase Supabase merely “for safety.” Combine the gates only for cross-system identity or complete-stack behavior.

See [adding a WISER system](/en/development/adding-a-system/) for the complete new-system and module-registration checklist.
