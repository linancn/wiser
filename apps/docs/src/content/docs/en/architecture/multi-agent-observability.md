---
title: Multi-agent control and observability
description: The v2 design for scenario management, multi-agent Runs, OTel-style traces, and historical-perspective replay.
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

## Observatory layout

The application separates the scenario center from exercise Runs. The management area owns draft validation and publication. The Run observatory is read-only by default and filters by scenario, version, phase, role, and agent.

```text
┌ Scenario / version / Run   virtual / boundary / reported mode ┐
├──────────────┬────────────────────────┬─────────────────────┤
│ Agent roster │ dual-clock waterfall   │ Span Inspector      │
│ EXCON        │ Inject / Evaluation    │ Attributes          │
│ Evidence     │ invoke_agent / tool    │ Events / Logs       │
│ Hydraulic    │ invoke_agent / tool    │ Span Links          │
│ Ecology      │ analyze / artifact     │ Domain Event        │
│ Coordinator  │ synthesize / submit    │ Telemetry gap       │
└──────────────┴────────────────────────┴─────────────────────┘
```

The visual signature is a collaboration watershed: agent lanes run like tributaries and converge at team submissions, evaluations, and feedback. Curves only encode real Span Links.

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

## First acceptance case

One immutable Yongding River version starts a four-role Run staffed by four distinct RunAgents. Each receives different receipts and works concurrently. Artifacts converge into a team submission; evaluation returns individual, role, and team feedback; switching replay perspective never reveals information that the chosen agent had not received. Deleting all telemetry must not break Event/Receipt replay.
