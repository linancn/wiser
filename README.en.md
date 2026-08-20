# WISER · Water Intelligence System & Engine for Reconfiguration

English · [中文（默认）](./README.md)

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

WISER supports perception, simulation, decision-making, and reconfiguration for water systems. Its first open-source core subsystem is **Agent Exercise Control Infrastructure / Agent EXCON**, which packages real-world work as runnable, replayable, and verifiable scenarios exposed through HTTP, MCP, and versioned file-based Skills.

The repository began with a testable single-agent compatibility slice for ecological replenishment and multi-source allocation in the Yongding River system. The default development protocol is now the v2 multi-scenario, multi-role team exercise: evidence, hydraulic, ecology, and dispatch-coordination agents receive different Receipts, execute Tasks concurrently, and collaborate explicitly through Messages, ArtifactVersions, Submissions, and Feedback.

Agents load [`skills/agent-excon`](./skills/agent-excon/SKILL.md) and participate through HTTP or MCP. Web never impersonates a participant; it provides multi-scenario management, run status, per-agent OTel-style traces, and historical-perspective replay backed by domain events and receipts.

## Engineering principles

- Real-use-case Red → Green → Refactor: tests define behavior before implementation.
- Deterministic evaluation first; AI may explain a verdict but never decides scores.
- Local development reuses `codex login` by default; CI and deployments use a fake or OpenAI-compatible provider.
- Supabase supplies Auth, PostgreSQL, Storage, and local tooling; complex transactions use `pg` and SQL.
- PostgreSQL state tables handle initial asynchronous work without Redis or another message broker.
- Chinese is the default UI and documentation locale, with matching English content.

## Delivered v2 increment

- `packages/contracts` and the pure `packages/core` define Scenario/Version/Run/RunAgent/Task/Barrier, Receipt/Event, Message/Artifact, Submission/Feedback, and deterministic state machines.
- Fastify exposes a development `/api/v2` slice for multi-scenario management, Run staffing, Receipt `/sync`, Task leases, collaboration artifacts, submissions/endorsements, and safe replay. It currently uses an **in-memory protocol adapter**, so state does not survive a process restart.
- Supabase includes the v2 PostgreSQL schema, constraints, RLS, private Event/Outbox/credential/telemetry tables, and pgTAP coverage, but Fastify is not yet connected through a PostgreSQL API adapter.
- The Agent EXCON Skill defaults to the v2 RunAgent loop. The stdio MCP server implements 18 v2 participant tools aligned with the HTTP routes, including Receipt-gated safe Submission recovery and bounded wait-and-sync that never advances virtual time. v1 is enabled only through explicit compatibility selection and never by automatic fallback.
- The local WorkBuddy Cookbook runs the real Yongding v2 collaboration flow in four isolated top-level processes. Its scripted and fault-injection profiles traverse the real MCP boundary and cover deterministic evaluation, scoped rework, three exact endorsements, and both barriers; live WorkBuddy starts only after explicit opt-in.
- The Compose `observability` profile includes the authenticated Telemetry Ingress, OTel Collector, Tempo, Prometheus, Loki, and Grafana. Domain Events/Receipts remain authoritative; OTel is a best-effort diagnostic projection.
- Web delivers Chinese-default multi-scenario, per-agent trace, and perspective-replay views in read-only reference and live modes. `live` reports data gaps explicitly and never falls back to or fabricates participant activity.

Important unfinished boundaries are the PostgreSQL API adapter and the v1-to-v2 compatibility facade. The current v2 is therefore a protocol/TDD/local-debugging slice, not a durable production platform.

## Intended workspace

```text
apps/          HTTP API, read-only Web, worker, MCP, and Starlight documentation
cookbooks/     Local multi-agent TDD, WorkBuddy launch, and redacted reports
packages/      Contracts, pure domain core, and infrastructure adapters
scenarios/     Versioned scenarios and provenance manifests
skills/        Independently publishable Agent EXCON Skill
supabase/      Configuration, migrations, seeds, and database tests
tests/         Cross-boundary acceptance tests
```

## Environment baseline

- Node.js 24 LTS (`24.19.0` recommended; compatible range `>=24.18.0 <25`)
- pnpm 11
- Docker Engine 29+ / Docker Compose 5+
- Codex CLI (the default local AI provider)

Install and verify:

```bash
corepack enable
pnpm install
pnpm verify
```

Start the complete development stack:

```bash
pnpm stack:up
```

Supabase CLI first starts Auth/PostgreSQL 17/Storage/Studio, then Compose starts API, read-only Web, worker, and docs. Defaults are Web `:3000`, API `:3001`, worker health `:3002`, docs `:4321`, and Supabase Studio `:56323`. Stop with `pnpm stack:down`.

Start the optional local technical-observability stack with:

```bash
pnpm observability:up
```

It exposes a participant OTLP/HTTP ingress on loopback `:14318`, trusted platform OTLP on `:4317/:4318`, Grafana on `:3300`, and Prometheus on `:9090`, with local Trace/Log storage in Tempo/Loki. The ingress binds RunAgent identity, overwrites reported identity, applies quotas, and rejects sensitive fields. `pnpm observability:down` stops only these services and preserves named volumes.

Codex subscription auth is host-only for trusted local development. Containers and CI default to the fake provider. Never commit or mount `~/.codex/auth.json`, Supabase service-role keys, or other credentials.

## Project status

The v2 contracts, pure domain core, in-memory HTTP collaboration slice, database schema/RLS, Skill, 18 MCP tools, safe Submission recovery, deterministic evaluation/rework/endorsement loop, and authenticated observability path are verifiable today. The [WorkBuddy TDD Cookbook](./cookbooks/workbuddy-yongding-tdd/README.md) provides a repeatable local four-agent entrypoint. Durable wiring is still in progress. The v1 Episode is an **explicit compatibility protocol** and is still a separate implementation, not a completed v2 facade. Scope and acceptance criteria live in [`docs/roadmap.md`](./docs/roadmap.md), with the complete design in [`docs/design/v2-multi-scenario-multi-agent-observability.md`](./docs/design/v2-multi-scenario-multi-agent-observability.md). Contribution rules are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Code is available under the [MIT License](./LICENSE). Scenario data and third-party materials retain the licenses declared in their own `PROVENANCE.md`; the MIT license does not automatically cover them.
