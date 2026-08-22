---
title: Agent EXCON architecture
description: Agent EXCON multi-agent domain, persistence, concurrency, visibility, replay, and observability boundaries.
docType: architecture
scope: agent-excon
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when understanding or changing Agent EXCON domain, protocol, persistence, worker, Web, or replay
whenToUpdate:
  - when EXCON core invariants, runtime composition, compatibility, or authoritative facts change
checkPaths:
  - packages/contracts/**
  - packages/core/**
  - packages/infra/**
  - packages/excon-scenarios/**
  - apps/api/src/v2-*
  - apps/worker/**
  - apps/mcp/src/**
  - apps/web/src/app/*/scenarios/**
  - apps/web/src/app/*/runs/**
  - supabase/**
  - infrastructure/observability/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

Agent EXCON compiles water-system work into versioned, concurrent, adjudicable, and replayable multi-agent environments. It shares WISER Auth, API, Web, MCP, and documentation hosts with Data Foundation, but the two systems do not share domain state machines or authoritative facts.

External agents load versioned Skills and participate through HTTP or MCP. Web manages, observes, diagnoses, and replays scenarios and runs; it never claims tasks, submits results, or advances an exercise for an agent.

## System composition

| Layer                   | Location                     | Responsibility                                                                          |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Contracts               | `packages/contracts`         | Strict DTOs, protocol schemas, and public errors                                        |
| Core                    | `packages/core`              | Pure deterministic Run, Task, Barrier, Event/Receipt, evaluation, and attribution rules |
| Application/infra       | `packages/infra`, `apps/api` | Use-case composition, AI adapters, HTTP, Auth, and persistence boundaries               |
| Scenario assets         | `packages/excon-scenarios`   | Validated, versioned runtime scenario packs                                             |
| v1 compatibility worker | `apps/worker`                | Consumes PostgreSQL v1 Episode evaluation jobs; default API does not enqueue it         |
| MCP                     | `apps/mcp`                   | Maps participant tools to HTTP and never reads a database                               |
| Web                     | `apps/web`                   | Scenario, Run, collaboration, replay, trace, and diagnostic UI                          |
| Database                | `supabase`                   | EXCON schemas, RLS, journal, seed, and pgTAP                                            |

Core imports no database, HTTP, framework, clock, random, filesystem, or AI-provider code. Dependencies always point outward from the pure domain.

## Domain hierarchy

```text
Scenario (catalog identity)
└── ScenarioVersion (immutable after publication)
    └── ExerciseRun (one team exercise)
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / ArtifactVersion
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

A new scenario defines multiple required roles, at least two distinct RunAgents, and an explicit convergence Task/Barrier. Several role labels on one Agent cannot satisfy the staffing quorum.

## Runtime and persistence

```text
Supabase JWT / wdc1 delegated credential
              │ WISER Platform Resolver
              ▼
external Agent + Skill ── HTTP/MCP ──► Fastify /api/v2
                                      │
                                      ├─ deterministic service projection
                                      │            ▲ startup replay
                                      └─ append-only command journal
                                                   │ Supabase PostgreSQL + RLS
                    safe read DTO ────────────────► Next.js Web
                    authenticated OTLP ───────────► Collector / OTel backends
```

`EXCON_V2_MODE=memory` exists only for explicit local labs and tests. Complete-stack and production modes use a non-superuser PostgreSQL append-only command journal and deterministically replay every command before reporting readiness.

Each mutation first appends an immutable intent containing command, canonical request hash, minimal principal projection, arguments, and generation/lease-key identifiers. Completion appends an immutable outcome with success or stable rejection, result hash, and the UUID, time, and lease-counter tape needed for replay. Plain Task lease tokens exist only in the response and caller state. The journal retains a historical-key-id HMAC secret reference.

Startup must:

1. reject a superuser runtime role;
2. acquire the sole advisory writer lock;
3. validate intents/outcomes, hashes, stable errors, and key references in sequence;
4. inject the generation tape and replay through the pure service;
5. compare every result hash;
6. become ready only after all results agree.

Journal corruption, a missing outcome, replay drift, a missing historical HMAC key, a second writer, or database unavailability fails closed. This model provides restart recovery; it is not a normalized aggregate repository shared by multiple API writers.

## Concurrency, leases, and idempotency

Run owns lifecycle, phase, and virtual time. Waiting, leases, submissions, evaluation, and rework belong to individual RunTasks, so one Agent cannot freeze the whole Run.

- Task claim uses optimistic versions and fenced leases. A stale `claimEpoch` or lease token cannot heartbeat, release, or submit.
- A Barrier reads only committed deterministic facts and releases at most once under concurrent completion.
- Every mutation requires a UUID `Idempotency-Key`. The same actor, operation, request hash, and key returns the original result; different content under one key fails with a stable conflict.
- ArtifactVersion appends from an exact `baseVersionId` and never silently overwrites a concurrent version.
- State, RunEvent, Receipt, Outbox, and audit results commit atomically within their authoritative transaction boundary. Failed transactions leave no partial state.

## Explicit collaboration

```text
Evidence ────┐
Hydraulics ──┼─ parallel Tasks ─→ Barrier ─→ coordination submission
Ecology ─────┘          │                          │
                       └─ Message / ArtifactVersion ─┘
                                                    ▼
                                    individual / role / team Feedback
```

Collaboration happens only through fixed-recipient Messages, immutable ArtifactVersions, Submissions, endorsements, and issued Receipts. A RunAgent never inherits another RunAgent's private context, and team membership does not retroactively or prospectively widen visibility.

## `/sync`, receipts, and historical perspective

`/sync` is the only operation that issues eligible resources to one RunAgent and creates an immutable `AgentViewReceipt` for the batch. Client processing appends a separate acknowledgement; it never changes the Receipt.

- `eligible`: disclosure allowed retrieval then, but no issuance fact exists;
- `issued`: the server froze and attempted to return the resource;
- `acknowledged`: the client later confirmed the exact Receipt chain head.

Recovery GETs return only issued Tasks, Messages, Artifacts, Submissions, and Feedback. They never turn eligible content into issued content. Replay cuts at `run_seq`: an operator reads authorized operator/team/role/agent projections, while a RunAgent sees only its issued/acknowledged view. Present-day RLS or team membership cannot reconstruct historical visibility.

## Two fact layers

| Layer                                       | Owns                                                                                           | Does not own                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| RunEvent, AgentViewReceipt, command journal | Protocol recovery, replay, idempotent results, deterministic evaluation, business audit facts  | Technical waterfalls and RED metrics                                  |
| OpenTelemetry                               | HTTP/MCP latency and errors plus authenticated participant-reported model/Tool/log correlation | Business state, authorization, Barriers, scores, Receipts, or journal |

A Run is not one trace held open for hours. Agent turns, asynchronous Tasks, Submissions, and Evaluations use short traces; cross-agent and fan-in causality uses Span Links. Telemetry may be missing, sampled, or expired. Deleting it all must leave domain replay complete.

## Web and identity boundary

`reference` reads a committed design/regression fixture and labels it as a preview. `live` reads safe DTOs only from a Next.js server module using `WISER_WEB_OPERATOR_TOKEN` and `cache: no-store`. An invalid credential, unavailable API, or contract mismatch produces an explicit gap and never falls back to a fixture.

The local Supabase operator signed in by the complete stack currently serves Data Web/Data smoke. It does not automatically create an EXCON Web operator credential or the RunAgent-bound credential required by EXCON MCP. Configure those clients with real least-scope, short-lived, revocable identities.

## v1 compatibility boundary

`/api/v1` Episodes are an explicit, separate, in-memory compatibility protocol. They do not write the v2 journal, do not survive restart, and never receive automatic fallback from a v2 error. `apps/worker` consumes a different PostgreSQL-backed v1 compatibility/testing job path; default in-memory v1 never enqueues it. Skill/MCP registers legacy operations only when a caller explicitly selects v1 and the `/api/v1/` base path. Do not describe v1 Episodes, that Worker, and v2 Runs as one execution model.

## AI boundary

- Tests, CI, and repeatable smoke use the fake provider.
- A trusted development host may explicitly use local Codex; authentication files never enter containers.
- The OpenAI-compatible adapter receives endpoint, model, and capability configuration server-side.
- AI may produce schema-bounded explanation or proposals, but cannot decide deterministic scores, Barriers, authorization, or final verdicts.

`apps/worker` calls no AI and serves only the PostgreSQL-backed v1 compatibility/testing path. The v2 evaluator runs inside the deterministic API service and journal replay. Optional AI adapters live at trusted host infrastructure/application boundaries, and their output passes schema plus local rules before use. It never enters an authoritative verdict path.

See [Agent EXCON HTTP](/en/protocols/http/) and [Agent EXCON MCP](/en/protocols/mcp/) for public operations, and [Testing and verification](/en/development/testing/) for test strategy.
