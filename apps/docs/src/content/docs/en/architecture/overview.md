---
title: Architecture
description: Boundaries between WISER, Agent EXCON, multiple scenarios and agents, authoritative replay, and OpenTelemetry.
---

## Product context

**WISER — wiser water, better future**<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON is WISER's first subsystem. It compiles water-system tasks into versioned, concurrent, adjudicable, and replayable multi-agent environments.

Agents participate through versioned Skills over HTTP/MCP. The Web manages scenarios and presents status, traces, and replay; it does not act as a participant.

## v2 hierarchy

```text
Scenario (catalog identity)
└── ScenarioVersion (immutable blueprint)
    └── ExerciseRun (one team exercise)
        ├── RunAgent / RoleSlot
        ├── RunTask / Barrier
        ├── Message / Artifact
        ├── Submission / Evaluation / Feedback
        ├── RunEvent / AgentViewReceipt
        └── Trace / Span / Log / Metric
```

Every newly published v2 scenario requires multiple roles staffed by at least two distinct RunAgent instances and an explicit team-integration task. One agent holding several roles cannot satisfy the required-role quorum. The former single-agent Episode remains only as a v1 compatibility slice.

## System boundary

```text
External agents + Agent EXCON Skill ── HTTP / MCP ──► Protocol API
                                                         │
Next.js scenario, observatory, and replay ◄─ safe views ──┤
                                                         ▼
                                      EXCON tasks / barriers / rules
                                         │                 │
                                         ▼                 ▼
                                  PostgreSQL          Worker / evaluator
                                  Auth / RLS               │ OTLP
                                  Event / Receipt          ▼
                                         └──────► OTel Collector
                                                    ├─ Tempo
                                                    ├─ Prometheus
                                                    └─ optional Loki
```

## Two fact layers

| Layer                                 | Owns                                                                                                                                           | Does not own                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| PostgreSQL domain events and receipts | complete replay, state recovery, persisted scoring inputs/results, audit, authorization, and historical perspectives                           | technical waterfalls and service RED metrics     |
| OpenTelemetry projection              | server-boundary latency/errors plus authenticated participant-reported model/tool calls, token use, correlated logs, and cross-trace causality | business state, authorization, or complete audit |

Traces may be sampled or expire, so OTel is never the sole exercise record. A Run is also not one giant Trace: agent turns, asynchronous tasks, submissions, and evaluations form short traces joined with Span Links. EXCON always observes HTTP/MCP boundaries; internal spans exist only when an external runtime exports through a RunAgent-bound telemetry ingress and are labelled participant-reported.

## Multi-agent execution

A Run owns lifecycle, phase, and virtual time. Waiting, submission, evaluation, and rework belong to independent Tasks so one agent cannot freeze the team.

```text
Evidence agent ────┐
Hydraulic agent ───┼─ parallel Tasks ─→ Barrier ─→ Coordinator ─→ Team submission
Ecology agent ─────┘                                 │
                                                    ▼
                                  Individual / role / team feedback
```

Agents never inherit one another's private context. They collaborate only through Messages, immutable ArtifactVersions, and Submissions with fixed recipient snapshots.

## Historical perspective replay

Present-day RLS or membership cannot reconstruct what an agent knew in the past. Every HTTP/MCP response prepared for an agent produces an immutable `AgentViewReceipt`; client confirmation appends a separate acknowledgement rather than mutating the receipt. Replay distinguishes:

- `acknowledged`: the client later confirmed receipt;
- `issued`: the server froze and attempted delivery;
- `eligible`: a disclosure grant made content available, but no receipt was issued.

Receipt issuance and acknowledgement carry separate `issued_run_seq` and `acknowledged_run_seq` values. The replay cursor is authoritative by `run_seq` and also displays virtual time and wall time. A server-side as-of projection rebuilds water state, Tasks, Agents, issued Inject payloads/receipts, artifacts, submissions, evaluations, and delivered feedback.

## Responsibilities

| Component           | Owns                                                                                        | Does not own                                    |
| ------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Next.js Web         | scenario/version catalog, read-only Run observatory, multi-agent traces, perspective replay | participant submissions or bypassing admin APIs |
| Fastify API         | v1 compatibility, `/api/v2`, auth, idempotency, transactions, safe DTOs                     | rendering or agent strategy                     |
| Domain Core         | Run/Task/Barrier state, visibility, deterministic rules                                     | provider-private model behavior                 |
| Worker              | evaluation jobs, retries, outcome ingestion                                                 | bypassing the state machine                     |
| Supabase/PostgreSQL | facts, locks, RLS, Auth, Storage, events, receipts                                          | natural-language verdicts                       |
| MCP Server          | stable HTTP mappings as Tools/Resources                                                     | business duplication or direct database access  |
| OTel/Grafana        | technical observability, diagnosis, deep links                                              | audit, authorization, or final verdicts         |

## AI and Compose

- **Codex local:** the development/debug default using host subscription sign-in.
- **OpenAI-compatible:** a deployment/provider mode with pinned endpoint, model, and capabilities.
- **Fake:** deterministic unit, integration, and CI default.

Supabase CLI manages the local compatible data platform. Repository Compose manages API, Web, Worker, and docs. v2 adds an optional observability profile with OTel Collector, Tempo, Prometheus, Grafana, and optional Loki.

The complete domain model, API, schema, TDD matrix, and migration sequence live in `docs/design/v2-multi-scenario-multi-agent-observability.md` in the repository.
