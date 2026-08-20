---
title: Architecture
description: Current WISER Agent EXCON v2 implementation, target boundaries, multi-agent collaboration, authoritative replay, and OpenTelemetry.
---

## Product context

**WISER — wiser water, better future**<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON is WISER's first subsystem. It compiles water-system tasks into versioned, concurrent, adjudicable, and replayable multi-agent environments.

External agents load versioned Skills and participate through HTTP/MCP. Web manages and presents scenarios, Runs, traces, and replay; it never submits, advances, or calls a Tool on an agent's behalf.

## Current implementation snapshot

| Layer               | Delivered                                                                                                                                            | Boundary / not delivered                                                                             |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Contracts/Core      | Strict v2 DTOs; pure deterministic Run, Task, Barrier, Event/Receipt, Feedback, and attribution state machines                                       | Remains infrastructure-independent by design                                                         |
| Fastify API         | Public/manage scenarios, Agent/Run, `/sync`, Task leases, Messages/Artifacts, Submissions/endorsements, safe recovery, Events/replay/trace summaries | A non-durable **in-memory protocol adapter**                                                         |
| Supabase/PostgreSQL | v2 schema, constraints, RLS, private Event/Outbox/credential/telemetry tables, seed, and pgTAP                                                       | No PostgreSQL API adapter wiring                                                                     |
| Skill/MCP           | v2-first RunAgent Skill; 18 stdio MCP Tools including Receipt-gated recovery and bounded wait-and-sync; explicit v1 compatibility                    | The complete local evaluation loop remains a non-durable development profile                         |
| Observability       | Authenticated Telemetry Ingress, Collector, Tempo, Prometheus, Loki, Grafana, identity overwrite, quotas, redaction, and smoke verification          | Internal participant spans still depend on an external exporter; telemetry never becomes audit truth |
| Web                 | Chinese-default multi-scenario read-only reference/live modes, per-agent traces, trust/coverage labels, and perspective replay                       | Live reports missing data explicitly and never falls back to fixtures or fabricates activity         |

The v1 Episode remains only as an explicit compatibility protocol. It is still a separate implementation, not a completed facade translating onto v2 Events/Receipts.

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

Every newly published v2 scenario defines multiple required roles, at least two distinct RunAgents, and an explicit team-convergence condition. Multiple role labels on one agent cannot satisfy quorum.

## Runtime boundary: current and target

```text
External agents + Agent EXCON Skill
                  │ HTTP / MCP
                  ▼
        Fastify /api/v2 protocol
        [current: in-memory adapter]
             │            │
             │ safe DTO   ├── OTLP boundary telemetry
             ▼            ▼
  Next.js read-only Web  OTel Collector ─┬─ Tempo
  reference / live                      ├─ Prometheus
                                        └─ Loki
                                           ▲
external exporter → authenticated ingress ─┘

Supabase/PostgreSQL v2 schema + RLS + Event/Receipt are delivered
             ▲
             └── [target: atomic PostgreSQL API adapter; not connected yet]
```

The Compose `observability` profile is an opt-in local technical-diagnostics group, but starting the profile always includes Collector, Tempo, Prometheus, Loki, Grafana, and Telemetry Ingress. Loki is not a later optional component.

## Two fact layers

| Layer                                                    | Owns                                                                                                                                             | Does not own                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| PostgreSQL domain Events and Receipts (target authority) | complete replay, recovery, persisted scoring inputs/results, audit, authorization, and historical perspectives                                   | technical waterfalls and service RED metrics                       |
| OpenTelemetry projection                                 | HTTP/MCP boundary latency/errors plus authenticated participant-reported model/Tool calls, token use, correlated logs, and cross-trace causality | business state, authorization, Barriers, scores, or complete audit |

The current in-memory API implements the same Event/Receipt projection semantics for TDD. Only PostgreSQL adapter wiring can satisfy durability, transaction, and failure-recovery requirements. The existence of a schema does not mean the running API uses it.

Traces may be sampled or expire, so a Run is not one trace kept open for hours. Agent turns, asynchronous Tasks, Submissions, and Evaluations form short traces. Parent/child captures one call tree; cross-agent and fan-in causality uses Span Links. The platform observes its HTTP/MCP boundaries. Internal external-agent spans exist only when the participant exports them through the authenticated ingress and remain `participant_reported`.

## Multi-agent execution

Run owns lifecycle, phase, and virtual time. Waiting, leases, submissions, evaluation, and rework belong to independent Tasks so one agent cannot freeze the team.

```text
Evidence ────┐
Hydraulics ──┼─ parallel Tasks ─→ Barrier ─→ Coordinator ─→ Team Submission
Ecology ─────┘          │                     │
                       └─ Message / ArtifactVersion ─┘
                                                 ▼
                                 Individual / role / team Feedback
```

Agents never inherit another agent's private context. Collaboration happens only through fixed-recipient Messages, ArtifactVersions, Submissions, endorsements, and already-issued Receipts.

## Historical-perspective replay

Present-day RLS or team membership cannot reconstruct past visibility. `/sync` creates an immutable `AgentViewReceipt` for a resource actually issued to one RunAgent. Client confirmation appends a separate acknowledgement and never mutates the Receipt.

- `acknowledged`: the client later confirmed receipt;
- `issued`: the server froze and attempted delivery;
- `eligible`: a disclosure grant allowed access, but no Receipt was issued.

Replay uses `run_seq` as the authoritative cutoff while displaying virtual and wall time. Operators may read authorized operator/team/role/agent projections. A RunAgent can read only its own issued/acknowledged view. The browser never receives full facts and pretends to authorize them by hiding fields.

The current in-memory service provides as-of replay. The target PostgreSQL adapter must commit state, Event, Receipt, idempotency, and Outbox facts in one explicit transaction boundary. The v1 facade/backfill also remains incomplete.

## Web reference and live modes

`reference` mode uses fixed fixtures to explain the collaboration watershed, agent lanes, trace trust/coverage, and perspective replay. It is a design reference, not evidence of an actual external-agent run.

The `live` mode uses an operator token only in a server module and reads public scenarios, Runs/RunAgents, operator replay, and trace-summary DTOs with `cache: no-store`. It fails closed on fetch or contract errors and never falls back to fixtures. When the API lacks checkpoint, water topology, complete AgentIdentity/model/tool data, or Span details, Web displays a gap instead of fabricating it.

## Component responsibilities

| Component                        | Current responsibility                                                                                    | Forbidden                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Next.js Web                      | scenario/reference and read-only live Run views, trace summaries, replay, and gap rendering               | participant mutations or treating operator data as an agent perspective     |
| Fastify API                      | separate v1 compatibility routes; v2 in-memory protocol, auth, idempotency, state machines, and safe DTOs | claiming durability or using Web as a participant client                    |
| Domain Core                      | pure deterministic Run/Task/Barrier/Receipt/Feedback rules                                                | database, HTTP, clock, random, filesystem, or AI-provider imports           |
| Worker                           | existing deterministic queue/evaluation foundation                                                        | bypassing state machines or claiming the complete v2 evaluator chain exists |
| Supabase/PostgreSQL              | delivered schema, RLS, constraints, private facts, and credential boundary                                | being described as runtime API storage before adapter wiring                |
| MCP Server                       | strict Tools/Resource mapped to implemented HTTP operations                                               | duplicated business logic, direct database access, or automatic v1 fallback |
| Telemetry Ingress + OTel/Grafana | technical observation, identity enforcement, redaction, diagnosis, and deep links                         | audit, authorization, Barriers, or verdicts                                 |

## AI and local operations

- **Codex local:** trusted host-side development/debug default using the local subscription sign-in; credentials never enter containers.
- **OpenAI-compatible:** deployment/provider mode with a pinned endpoint, model, and capability set.
- **Fake:** deterministic unit, integration, and CI default.

Supabase CLI manages local Auth, PostgreSQL, Storage, PostgREST, and Studio. Repository Compose manages API, Web, Worker, docs, and the `observability` profile. The full target model, migration, and TDD matrix live in `docs/design/v2-multi-scenario-multi-agent-observability.md`.
