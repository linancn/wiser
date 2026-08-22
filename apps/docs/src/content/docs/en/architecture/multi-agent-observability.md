---
title: Multi-agent control and observability
description: The v2 design for scenario management, multi-agent Runs, OTel-style traces, and historical-perspective replay.
docType: architecture
scope: observability
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing the observatory, replay, or technical telemetry path
whenToUpdate:
  - when authority, telemetry trust, or presentation behavior changes
checkPaths:
  - apps/web/**
  - apps/telemetry-ingress/**
  - infrastructure/observability/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

## A Run is a team exercise

v2 navigates `Scenario → ScenarioVersion → ExerciseRun → RunAgent`. Every new scenario defines multiple required roles staffed by distinct RunAgent instances, parallel Tasks, convergence Barriers, and a team submission. It does not merely add labels to one participant.

Run owns phase and virtual time; evaluation and rework belong to each Task. Evidence, hydraulic, ecology, and coordination agents can therefore work concurrently.

```text
Evidence ────┐
Hydraulics ──┼─ Artifact/Message ─→ Coordinator ─→ Team Submission
Ecology ─────┘                              │
                                           ▼
                               Individual / role / team feedback
```

## Control-room information architecture

Agent EXCON context navigation contains only **Scenarios** and **Exercise runs** beneath WISER primary system navigation; these tasks never compete with Data Foundation or Portal. Scenarios own drafts, validation, publication, versions, and team contracts. Exercise runs are read-only by default, and every Run is split into **Overview / Collaboration / Evaluation / Trace / Replay** object-local workspaces.

- **Overview** answers authority status, highest risk, and next action first. It shows at most three attention items, team posture, recent events, and the basin decision spine.
- **Collaboration** renders requests/responses, ArtifactVersion handoffs, and per-recipient Receipt state as a confluence ledger. It never labels acknowledgement as read or agreement.
- **Evaluation** reconciles authoritative Events, Barriers, and evaluator verdicts. OpenTelemetry coverage gaps remain diagnostic signals and never replace the verdict.
- **Trace** uses a wall-clock waterfall, agent lanes, and a Span Inspector for execution debugging; narrow screens switch to a scannable event stream.
- **Replay** reconstructs receipts, events, and visible evidence by `run_seq` and historical perspective. Technical telemetry remains a best-effort overlay.

```text
Scenarios ──→ Scenario configuration ──→ related Runs
                                             │
Exercise runs ─────→ Run overview ───────────┼─→ Evaluation
                                             ├─→ Collaboration
                                             ├─→ Trace
                                             └─→ Replay
```

The Run overview's visual signature is the **basin decision spine**: evidence, hydraulics, and ecology roles flow in parallel through an analysis Barrier, coordination, an endorsement Barrier, and finally the authoritative verdict. Every node and connection comes from real role, Barrier, and verdict data. Collaboration uses only Message, ArtifactVersion, and Receipt facts; Trace connections likewise encode only real Span Links.

## What WISER adopts from OTel

- A Run is a correlation scope, not a trace kept open for hours.
- Agent turns, asynchronous Tasks, submissions, and evaluations form short traces.
- Parent/child expresses one call tree; cross-agent and fan-in causality uses Span Links.
- EXCON always observes HTTP/MCP boundaries. Internal agent/model/tool spans exist only when a participant exports them through the authenticated ingress, and remain `participant_reported`.
- The waterfall axis is wall time; domain markers carry `run_seq` and virtual time.
- Prompts, tool bodies, hidden outcomes, private feedback, and hidden reasoning stay out of OTLP by default.
- Missing traces display as “not observed”; authoritative domain replay still works.

A mapping adapter converts OTel data into stable WISER DTOs because GenAI/Agent/Tool/MCP conventions can still change. `traceparent` creates correlation but cannot obtain an external runtime's internal spans; without an exporter, the UI displays boundary telemetry only.

## Replay is not an animation

A server-side `authoritativeProjection` reconstructs the water system, Task/Agent/Barrier state, collaboration artifacts, the selected perspective's Inject payloads/receipts issued through `/sync`, submissions, evaluations, and delivered feedback.

Authorized traces/logs arrive as a separate `bestEffortTelemetryOverlay` with source, trust, coverage, late, and dropped indicators. It never enters the agent-known set, scoring, or the signed replay manifest.

An immutable issuance `AgentViewReceipt` and a separate append-only acknowledgement distinguish delivered knowledge. Each has its own `run_seq`, making as-of semantics precise. Eligibility is projected from disclosure grants, not represented by a receipt. An unrequested Inject must never be described as known by that agent.

## Recommended stack

```text
Participant exporter → authenticated ingress ┐
WISER services ───────────────────────────────┴→ OTel Collector → Tempo
                                                             → Prometheus
                                                             → Loki
Grafana ← Tempo + Prometheus + Loki
```

Participants cannot connect directly to the Collector. Ingress binds the RunAgent identity, overwrites identity attributes, applies quotas, and rejects sensitive bodies. WISER owns Run-level collaboration and domain replay. Grafana/Tempo provide technical drill-down into an individual trace. `trace_id` and `event_id` create bidirectional deep links.

## Acceptance case

One immutable Yongding River version starts a four-role Run staffed by four distinct RunAgents. Each receives different receipts and works concurrently. Artifacts converge into a team submission; evaluation returns individual, role, and team feedback; switching replay perspective never reveals information that the chosen agent had not received. Deleting all telemetry must not break Event/Receipt replay.
