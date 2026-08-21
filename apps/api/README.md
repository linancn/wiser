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
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# Agent EXCON API

Fastify HTTP boundary used by the versioned Agent EXCON Skill and the stdio MCP adapter. The Web app is read-only and is not the participant interface.

```bash
AGENT_EXCON_PARTICIPANT_TOKEN=local-demo-participant-token \
API_PORT=3001 \
pnpm --filter @agent-excon/api dev
```

The default `InMemoryExerciseService` (v1) and `InMemoryV2ExerciseService` are deterministic walking-slice adapters for local demos and contract tests. They are intentionally non-durable and provide no cross-process concurrency, transaction, RLS, Outbox, or recovery guarantee. Production must inject PostgreSQL/Supabase repositories implementing `ExerciseService` and `V2ExerciseService`; HTTP handlers, Skill, and MCP contracts do not change.

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
