# WISER · Water Intelligence System & Engine for Reconfiguration

English · [中文（默认）](./README.md)

**wiser water, better future**

**水地图：AI 赋能的水智能系统与重构引擎**

**Water Intelligence System & Engine for Reconfiguration, empowered by AI**

WISER supports perception, simulation, decision-making, and reconfiguration for water systems. Its first open-source core subsystem is **Agent Exercise Control Infrastructure / Agent EXCON**, which packages real-world work as runnable, replayable, and verifiable scenarios exposed through HTTP, MCP, and versioned file-based Skills.

The repository began with a testable single-agent compatibility slice for ecological replenishment and multi-source allocation in the Yongding River system. The v2 target is now a multi-scenario, multi-role team exercise: evidence, hydraulic, ecology, and dispatch-coordination agents receive different information, execute Tasks concurrently, converge through explicit artifacts, and receive distinct individual, role, and team feedback.

Agents load [`skills/agent-excon`](./skills/agent-excon/SKILL.md) and participate through HTTP or MCP. Web never impersonates a participant; it provides multi-scenario management, run status, per-agent OTel-style traces, and historical-perspective replay backed by domain events and receipts.

## Engineering principles

- Real-use-case Red → Green → Refactor: tests define behavior before implementation.
- Deterministic evaluation first; AI may explain a verdict but never decides scores.
- Local development reuses `codex login` by default; CI and deployments use a fake or OpenAI-compatible provider.
- Supabase supplies Auth, PostgreSQL, Storage, and local tooling; complex transactions use `pg` and SQL.
- PostgreSQL state tables handle initial asynchronous work without Redis or another message broker.
- Chinese is the default UI and documentation locale, with matching English content.

## Intended workspace

```text
apps/          HTTP API, read-only Web, worker, MCP, and Starlight documentation
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

It exposes loopback-only OTLP on `:4317/:4318`, Grafana on `:3300`, and Prometheus on `:9090`, with local Trace/Log storage in Tempo/Loki. `pnpm observability:down` stops only these services and preserves named volumes. The Collector is a trusted local ingress; production participant telemetry must still pass through an authenticated RunAgent-bound ingress.

Codex subscription auth is host-only for trusted local development. Containers and CI default to the fake provider. Never commit or mount `~/.codex/auth.json`, Supabase service-role keys, or other credentials.

## Project status

The v1 walking skeleton is runnable; v2 is migrating through TDD to multi-scenario, multi-agent, observable control. Scope and acceptance criteria live in [`docs/roadmap.md`](./docs/roadmap.md), with the complete design in [`docs/design/v2-multi-scenario-multi-agent-observability.md`](./docs/design/v2-multi-scenario-multi-agent-observability.md). Contribution rules are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Code is available under the [MIT License](./LICENSE). Scenario data and third-party materials retain the licenses declared in their own `PROVENANCE.md`; the MIT license does not automatically cover them.
