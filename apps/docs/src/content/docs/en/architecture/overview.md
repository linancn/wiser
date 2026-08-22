---
title: Agent EXCON architecture
description: Agent EXCON v2 multi-agent domain, durable command journal, authoritative replay, and OpenTelemetry boundary.
docType: architecture
scope: agent-excon-v2
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing EXCON v2 boundaries or understanding component relationships
whenToUpdate:
  - when core, protocol, persistence, or observability architecture changes
checkPaths:
  - packages/contracts/**
  - packages/core/**
  - apps/api/src/v2-*/**
  - apps/mcp/**
  - apps/web/**
  - supabase/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: fe6687b78bae4241b59c82280f4a97b2fcff05d3
---

## Product context

Agent EXCON is WISER's first business system. It compiles water-system work into versioned, concurrent, adjudicable, and replayable multi-agent environments. Data Foundation is a peer system. They share platform Auth and API/MCP/Web/docs hosts, but not domain state machines or authoritative facts.

External agents load versioned Skills and participate through HTTP/MCP. Web manages and presents scenarios, Runs, traces, and replay; it never submits, advances, or calls a Tool for an agent.

## Current implementation

| Layer               | Delivered                                                                                                                 | Explicit boundary                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Contracts/Core      | Strict v2 DTOs; pure Run, Task, Barrier, Event/Receipt, Feedback/attribution rules                                        | Core imports no infrastructure                                                   |
| Fastify API         | Scenario/Agent/Run, `/sync`, Task leases, Messages/Artifacts, Submissions/endorsements, recovery, Events/replay/traces    | v2 durability is command journal + replay, not normalized aggregate repositories |
| Supabase/PostgreSQL | v2 schema/RLS; append-only intent/outcome journal; non-superuser runtime role and pgTAP                                   | Journal has one writer; v1 state is not durable                                  |
| Skill/MCP           | v2-first Skill; 18 MCP Tools; Receipt-gated Submission recovery; bounded wait-and-sync                                    | Calls HTTP only; never reads journal/database                                    |
| Observability       | Telemetry Ingress, Collector, Tempo, Prometheus, Loki, Grafana, identity overwrite/quotas/redaction                       | Participant-internal spans depend on an exporter and never become audit truth    |
| Web                 | Chinese-default multi-scenario reference/live, per-agent traces, verdict/Barrier/revision diagnostics, perspective replay | Live shows gaps and never falls back or fabricates activity                      |

v1 Episodes remain an explicit, separate in-memory compatibility implementation. A v2 failure never downgrades automatically.

## v2 domain hierarchy

```text
Scenario (catalog identity)
└── ScenarioVersion (immutable blueprint)
    └── ExerciseRun (one team exercise)
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / ArtifactVersion
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

Every new scenario requires multiple roles, at least two distinct RunAgents, and an explicit convergence condition. Multiple labels on one Agent cannot satisfy quorum.

## Current runtime path

```text
Supabase JWT / wdc1 delegated credential
              │ unified Platform Resolver
              ▼
external Agent + Skill ─ HTTP/MCP ─► Fastify /api/v2
                                      │
                                      ├─ deterministic v2 service projection
                                      │      ▲ startup replay
                                      │      │
                                      └─ append-only command journal
                                             │ Supabase PostgreSQL / RLS
                                             │
                   safe DTO ────────────────► Next.js read-only Web
                   OTLP ────────────────────► Collector → Tempo/Prometheus/Loki
```

Non-production may explicitly select `EXCON_V2_MODE=memory`. The complete stack and production force `postgres` with a non-superuser DSN and an HMAC key ring retaining every historical key. API injects fixed Tenant/Project/Purpose and uses the same Platform Resolver for operator/run_agent roles and RunAgent bindings.

## Durable command-journal semantics

The journal covers 19 mutations: Scenario/Version, Agent/Version, Run/join/start, sync, Task claim/begin/heartbeat/release/submit, Message, Artifact/Version, and endorsement.

Each command first appends an immutable intent containing command name, canonical request hash, minimal principal projection, arguments, and lease key id. Completion appends an immutable outcome: success/stable rejection, result hash, generated UUID/time tape, and lease counter. Plain Task lease tokens exist only in the response and caller state; the journal stores key-id-bound HMAC secret references.

Startup:

1. verifies the DSN user is not a superuser;
2. acquires the sole advisory writer lock;
3. loads intent/outcome rows in sequence;
4. validates shapes, hashes, error codes, key references, and generation bounds;
5. injects the tape and replays every command through the deterministic service;
6. compares the success or stable-rejection hash;
7. becomes ready only after complete verification.

Corruption, missing outcome, replay drift, a missing historical HMAC key, a second writer, or database unavailability fails closed. This provides restart recovery and idempotent results, but not a mutable aggregate store shared by multiple API writers.

## Two fact layers

| Layer                                            | Owns                                                                                                          | Does not own                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Domain Events/Receipts + durable command journal | protocol recovery, Replay, Receipt chains, idempotent results, deterministic evaluation, security audit trail | technical waterfall and RED metrics                                   |
| OpenTelemetry projection                         | HTTP/MCP latency/errors plus authenticated participant-reported model/Tool, token, and log correlation        | business state, authorization, Barriers, scores, Receipts, or journal |

A Run is not one trace held open for hours. Agent turns, asynchronous Tasks, Submissions, and Evaluations form short traces; cross-agent/fan-in causality uses Span Links. Platform observation covers its own HTTP/MCP boundary. Internal external-agent spans require an authenticated exporter and remain `participant_reported`.

## Multi-agent execution and collaboration

Run owns lifecycle, phase, and virtual time. Waiting, leases, submissions, evaluation, and rework belong to independent Tasks so one Agent cannot freeze the team.

```text
Evidence ────┐
Hydraulics ──┼─ parallel Tasks ─→ Barrier ─→ coordination submission
Ecology ─────┘          │                          │
                       └─ Message / ArtifactVersion ─┘
                                                    ▼
                                    individual / role / team Feedback
```

Collaboration happens only through fixed-recipient Messages, immutable ArtifactVersions, Submissions, endorsements, and issued Receipts. One Agent never inherits another Agent's private context.

## `/sync` and historical perspective

Present-day RLS or team membership cannot reconstruct past visibility. `/sync` creates an immutable `AgentViewReceipt` for a resource actually issued to one RunAgent. Client confirmation appends a separate acknowledgement and never changes the Receipt.

- `acknowledged`: the client later confirmed the exact chain head;
- `issued`: the server froze and attempted delivery;
- `eligible`: disclosure allowed access then, but no Receipt exists.

Replay cuts at `run_seq`. Operators may read authorized operator/team/role/agent projections; a RunAgent sees only its issued/acknowledged view. Journal replay restores identical Events, Receipts, acknowledgements, and replay projection after restart. A different hash prevents readiness.

## Web reference/live

`reference` is a fixed design/regression fixture, not evidence of an external-agent run. `live` uses a valid operator credential only in a server module and reads safe DTOs with `cache: no-store`. It fails closed on fetch/contract errors and never falls back to reference. Without an external exporter, Web displays telemetry gaps and never invents model/tool spans.

## AI and local operations

- Codex local is trusted host-side development/debug only; local credentials never enter containers.
- OpenAI-compatible mode pins endpoint, model, and capability set.
- Fake is the test/CI default. AI never decides deterministic scores, Barriers, or final verdicts.

Supabase CLI manages unified Auth, the control plane, EXCON schema/journal, and pgTAP. Compose manages API, Web, Workers, docs, Data Foundation, and optional observability. Detailed invariants live in `docs/design/v2-multi-scenario-multi-agent-observability.md`.
