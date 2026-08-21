---
title: Agent EXCON HTTP API guide
docType: component-guide
scope: apps/api
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing or running the HTTP API boundary
whenToUpdate:
  - when API routes, authentication, or runtime durability changes
checkPaths:
  - apps/api/**
  - packages/contracts/**
  - packages/core/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 89cde4733d5f1772db7495fbfa0bd1b6cf4a18bf
---

# WISER API host

Shared Fastify HTTP composition host for WISER systems. Agent EXCON remains the first registered business protocol; Data Foundation joins through the same static module boundary.

```bash
AGENT_EXCON_PARTICIPANT_TOKEN=local-demo-participant-token \
API_PORT=3001 \
pnpm --filter @wiser/api dev
```

The default `InMemoryExerciseService` (v1) and `InMemoryV2ExerciseService` are deterministic walking-slice adapters for local demos and contract tests. They are intentionally non-durable and provide no cross-process concurrency, transaction, RLS, Outbox, or recovery guarantee. Production must inject PostgreSQL/Supabase repositories implementing `ExerciseService` and `V2ExerciseService`; HTTP handlers, Skill, and MCP contracts do not change.

`buildApp()` is the WISER Fastify composition root. Additional product systems register explicit, statically imported `WiserApiModule` values through `BuildAppOptions.modules`; module ids are namespaced and unique, and duplicate ids fail during readiness. Agent EXCON routes remain available while Data Foundation and future systems join the same process without copying the HTTP host.

`createPlatformIdentityModule()` adds the protected `GET /api/platform/v1/me` vertical slice when a `PlatformPrincipalResolver` is injected. It requires Bearer, Tenant, Project, and Purpose context and returns only the safe actor, role, scope, maximum-security-level, and authorization-version projection; credentials and Session ids never enter the response.

`createPlatformDelegationModule()` defines the human-only delegated-credential command surface. A verified Supabase principal must have `platform.delegation.manage`; requested Scope, Purpose, TTL, and L0-L3 ceiling may not exceed the live context. Every command requires a UUID `Idempotency-Key`, every response is `private, no-store`, metadata reads never expose a token, and issue/rotate are the only one-time plaintext responses. In Supabase mode the default process injects `PostgresPlatformDelegationService`, the live delegated Resolver, and the same bounded Pool.

`createDataFoundationModule()` mounts Data Foundation beside Agent EXCON without a second Fastify process. Its injected readiness probe drives truthful `GET /api/data/v1/health` status across data-postgres, object storage, and Worker. `GET /api/data/v1/capabilities` projects the ordered 22-item Zod 4 Registry into draft-7 input/output JSON Schema plus exact REST, GraphQL, MCP, and Skill mappings. Both responses are non-cacheable; the default process does not report Data Foundation ready until concrete authority probes are wired.

`DataCapabilityHandler` is the single in-process application boundary planned for Data Foundation REST and schema-first GraphQL. Startup fails unless every Registry Capability has exactly one executor. Each call validates Registry input/output, live Scopes, requested L0-L3 ceiling, UUID command idempotency, and the declared timeout; its audit record contains identity/context plus canonical SHA-256 hashes, never the payload. The Handler is delivered, but concrete business executors and the remaining REST/GraphQL routes are not yet runtime-wired. MCP and Skills must continue through HTTP rather than importing it.

`main.ts` creates the concrete Supabase `getClaims` client, PostgreSQL Membership/delegated loaders, transactional delegation service, and prefix-routed composite Resolver when `WISER_AUTH_MODE=supabase`. A `wdc1.` token is never retried as JWT after delegated verification fails. Production defaults to Supabase mode and refuses missing `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `DATABASE_URL`, or `WISER_DELEGATED_CREDENTIAL_HMAC_KEYS`; non-production defaults to `off` for the legacy local-token compatibility profile. The bounded shared Pool is closed through the Fastify lifecycle.

Participant requests use `Authorization: Bearer <token>`. Every POST uses a UUID `Idempotency-Key`; observe, submit, and advance also include `episodeVersion`.

Key routes:

- `GET /health/live`, `GET /health/ready`, `GET /openapi.json`
- `GET /api/v1/scenario`
- `POST /api/v1/episodes`, `GET /api/v1/episodes/{id}`
- `POST /api/v1/episodes/{id}/observe`, `GET .../observations`
- `POST /api/v1/episodes/{id}/submissions`
- `GET /api/v1/submissions/{id}/evaluation`
- `GET /api/v1/episodes/{id}/feedback`
- `POST /api/v1/episodes/{id}/advance`
- `GET /api/v1/episodes/{id}/events`

Deterministic evaluation never calls an LLM. AI adapters may create explanatory summaries outside the scoring boundary.

## v2 multi-agent protocol slice

Public scenario catalog reads require no bearer token and structurally omit draft and validation fields. Management, Agent catalog, Run lifecycle, event/replay, and observability reads require an explicit `operator` principal. `/sync` and the four issued-resource recovery routes require a separate `run_agent` principal bound to the concrete `runAgentId`; an operator token cannot act as a participant.

Every v2 POST requires a UUID `Idempotency-Key`. Scenario draft validation/publication, AgentVersion publication, and Run start use the version of the smallest changed aggregate. Joining a RunAgent does not consume the ExerciseRun lifecycle version, and each RunTask carries its own `lockVersion`.

Key v2 routes:

- `GET /api/v2/scenarios`, `GET /api/v2/scenarios/{id}` and published version reads
- `POST /api/v2/manage/scenarios`, `POST .../{id}/versions`, `POST .../{versionId}:validate|publish`
- `POST /api/v2/agents`, `POST /api/v2/agents/{id}/versions`
- `POST /api/v2/runs`, `POST /api/v2/runs/{id}/agents`, `POST /api/v2/runs/{id}:start`
- `POST /api/v2/runs/{id}/sync`
- `GET /api/v2/runs/{id}/tasks|messages|artifacts|feedback` (already issued only)
- `GET /api/v2/runs/{id}/events|replay|traces`

The replay response deliberately separates the complete, unsampled authoritative `RunEvent`/Receipt projection from the best-effort telemetry overlay. An empty sync batch has `fromReceiptSeq: null`; acknowledgements append a new event and never mutate an issuance Receipt.
