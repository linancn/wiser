# WISER Agent EXCON roadmap / 路线图

## Product context

**WISER — wiser water, better future**<br />
水地图：AI 赋能的水智能系统与重构引擎<br />
Water Intelligence System & Engine for Reconfiguration, empowered by AI

Agent EXCON（智能体演练场 / 导调中枢）是 WISER 的首个子系统。智能体通过 Skill + HTTP/MCP 参训；Web 负责场景管理、态势展示、可观测性和回放，不代替智能体完成演练。

## Delivered baseline — v1 walking skeleton

The repository already runs one fixed, versioned, two-stage Jing-Jin-Ji water-system exercise from episode creation through observation, allocation planning, deterministic feedback, virtual-time advance, final evaluation, and audit replay.

- MIT monorepo, current compatible pinned dependencies, Compose operations, CI, bilingual docs/Web.
- Supabase/PostgreSQL facts, RLS, idempotency, deterministic worker, HTTP and MCP.
- Versioned Agent EXCON Skill and Yongding River fact-anchored synthetic case.
- Chinese-default read-only Web for one scenario, one participant, and a flat event replay.

The v1 surface remains a compatibility slice; it is no longer the target product model.

## Active goal — v2 multi-scenario, multi-agent platform

The authoritative design is [WISER Agent EXCON v2](design/v2-multi-scenario-multi-agent-observability.md).

### Acceptance boundary

1. The scenario center manages multiple scenarios and immutable published versions.
2. Every new v2 scenario requires multiple roles staffed by distinct RunAgent instances and an explicit team-integration task.
3. One `ExerciseRun` hosts independent `RunAgent`, `RunTask`, and `Barrier` state; one agent cannot freeze the whole run.
4. Agents receive different immutable view receipts and collaborate only through explicit messages and artifact versions.
5. Individual, role, and team submissions/evaluations/feedback remain distinct and permission-aware.
6. PostgreSQL domain events and receipts provide complete as-of replay for operator, team, role, and agent perspectives.
7. OpenTelemetry always projects EXCON boundary spans and optionally accepts authenticated participant-reported agent/model/tool spans; the UI labels trust and coverage, and telemetry never becomes the audit source.
8. The Web separates scenario management from the read-only run observatory and never simulates participant actions.
9. Chinese remains the default; English preserves the same route, run, trace, filter, and replay cursor.
10. The v1 Episode workflow continues through a compatibility facade until usage reaches zero.

### Milestones

- **M0 — Design and reference UI:** v2 ADR, bilingual docs, multi-scenario catalog, multi-agent trace waterfall, and perspective replay fixture.
- **M1 — Read contracts/API:** plural Scenario/Version/Run/Agent/Event/Trace DTOs and safe observer endpoints.
- **M2 — Domain/database:** task/barrier concurrency, recipient snapshots, event/receipt chains, RLS, and migration facade.
- **M3 — Agent protocol:** general multi-agent Skill, role Skill Packs, MCP v2 tools, and the four-role Yongding River TDD case.
- **M4 — Observability profile:** authenticated participant ingress, OTel Collector, Tempo, Prometheus, Grafana, optional Loki, identity enforcement, redaction, correlation, and source-aware coverage.
- **M5 — Authoritative replay and management:** server-side as-of projection, draft validation/publish, run administration, and v1 backfill.

## Still out of scope

- Hidden chain-of-thought capture or display.
- OTel/Grafana as the business event store or authorization layer.
- LLM-generated deterministic scores, barriers, or verdicts.
- Default internal orchestration of participant agents.
- Kubernetes, Redis, Kafka, and production GIS editing in the first v2 slice.
