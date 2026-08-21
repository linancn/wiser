---
title: Quick start
description: Verify the Agent EXCON v2 multi-agent protocol slice, MCP adapter, and observability path locally.
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when first installing, verifying, or starting the local development stack
whenToUpdate:
  - when toolchain, commands, ports, or local service entry points change
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

## Know the current boundary first

The default development protocol is `/api/v2`, and the Agent EXCON Skill and MCP server also default to v2. Fastify implements multi-scenario management, RunAgent `/sync`, Task leases, Messages/Artifacts, Submissions/endorsements, and safe replay through an **in-memory protocol adapter**. The Supabase v2 schema/RLS exists but is not yet used by the API. A process restart therefore loses v2 API state: this is a protocol/TDD/local-debugging slice, not a durable production deployment.

The v1 Episode remains runnable only through explicit compatibility selection. It is not yet a facade over v2 facts, and a v2 failure never causes automatic downgrade.

## Baseline

| Tool             | Pinned baseline        | Purpose                                              |
| ---------------- | ---------------------- | ---------------------------------------------------- |
| Node.js          | 24 LTS                 | Web, API, Worker, MCP, and docs                      |
| pnpm             | 11                     | Workspace and exact dependency lock                  |
| Docker + Compose | Compose v5             | Application services and local observability profile |
| Supabase CLI     | Workspace-pinned       | Auth, PostgreSQL, and Storage                        |
| Codex CLI        | Signed in with ChatGPT | Trusted host-side development and debugging          |

```bash
node --version
pnpm --version
docker compose version
codex login status
```

## Install and verify

```bash
corepack enable
pnpm install
pnpm verify
```

## Documentation governance

The repository uses Docpact 0.1.9 to map implementation paths to documents that must be read, updated, or explicitly reviewed. Install the CLI, query the route before coding, and inspect unstaged worktree changes afterward:

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'packages/core/src/**'
pnpm docpact:check
```

Run `pnpm docpact:validate` after changing `.docpact/config.yaml` or CI. The pull-request gate blocks unmet documentation obligations and uncovered implementation changes.

To verify only the current v2 multi-agent protocol slice:

```bash
pnpm --filter @agent-excon/contracts test
pnpm --filter @agent-excon/core test
pnpm --filter @wiser/api test
pnpm --filter @wiser/mcp test
node skills/agent-excon/scripts/lint-skill.mjs
```

These tests cover distinct-role quorum, Task/Barrier state, Receipt chains, `/sync`, Task leases, Messages/Artifacts, Submissions/endorsements, Receipt-gated safe Submission recovery, deterministic evaluator → rework → resubmit, participant-safe replay, and MCP-to-HTTP mappings. The complete loop is delivered in the local in-memory profile; the durable PostgreSQL adapter is not connected yet.

## Unified Auth mode

Non-production defaults to `WISER_AUTH_MODE=off`, preserving the current EXCON local-token compatibility entry. To enable the unified Supabase identity slice, configure:

```dotenv
WISER_AUTH_MODE=supabase
SUPABASE_URL=http://127.0.0.1:56321
SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:56322/postgres
```

Production defaults to mandatory `supabase` mode and fails closed when any value is missing. Browsers use only `NEXT_PUBLIC_SUPABASE_*`; server variables and database connections never receive the `NEXT_PUBLIC_` prefix.

## Start local services

```bash
pnpm stack:up
```

Supabase CLI starts Auth/PostgreSQL 17/Storage/Studio. Compose starts API, read-only Web, Worker, and docs.

| Service         | Address                             |
| --------------- | ----------------------------------- |
| Web             | `http://127.0.0.1:3000/zh-CN`       |
| API             | `http://127.0.0.1:3001`             |
| Docs            | `http://127.0.0.1:4321`             |
| Worker health   | `http://127.0.0.1:3002/health/live` |
| Supabase Studio | `http://127.0.0.1:56323`            |

Read the public v2 catalog without credentials:

```bash
curl --fail http://127.0.0.1:3001/api/v2/scenarios
```

Operator mutations and RunAgent calls use separate bearer credentials. Participant requests also carry an `X-Run-Agent-Id` bound to the token. The default Compose participant token cannot impersonate an operator or arbitrary RunAgent. Before an interactive exercise, a trusted runtime must provision a short-lived token bound to the concrete Run/RunAgent.

## Participate through MCP

MCP calls only HTTP and never reads the database. Start it only after receiving a trusted `runId`, `runAgentId`, and short-lived RunAgent token:

```bash
export AGENT_EXCON_API_KEY=<short-lived-run-agent-token>
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

The default v2 loop is `assignment → sync/ack → issued Task → claim/begin/heartbeat → Message/Artifact → Submission → wait-and-sync → safe recovery/review → endorsement → Feedback → agent-safe replay`. See [MCP integration](/en/protocols/mcp/) for the 18 tools and implemented routes. `/sync` is the only new-content issuance operation; recovery GETs never turn eligible content into issued content.

Select both the protocol and URL only for an explicitly assigned legacy Episode:

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v1
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
```

## Start the technical-observability profile

```bash
pnpm observability:up
pnpm observability:smoke
```

The profile includes the Telemetry Ingress, OTel Collector, Tempo, Prometheus, Loki, and Grafana. Grafana is at `http://127.0.0.1:3300`. Participant OTLP/HTTP can enter only through `http://127.0.0.1:14318`; trusted platform OTLP uses loopback ports `4317/4318`. The ingress binds RunAgent identity, overwrites reported identity, applies quotas, and rejects sensitive fields. External agents cannot connect directly to the Collector.

```bash
pnpm observability:down
```

Stopping preserves named volumes. Traces, logs, and metrics are best-effort diagnostics; deleting them cannot affect Event/Receipt replay.

## Web data modes

Web delivers read-only `reference` and `live` modes. Reference is the deterministic build/E2E default and uses fixed fixtures for multi-scenario, per-agent trace, and perspective replay views; the Compose development stack selects live by default. Live fetches safe DTOs only from a server module with an operator token, fails closed, and reports missing checkpoint, topology, Agent detail, or Span detail instead of falling back to fixtures or fabricating participant activity.

Exercise mutations always come from external agents through Skill + HTTP/MCP. Web has no participant submission, clock-advance, or impersonation controls.

## Stop services

```bash
pnpm stack:down
```

Normal shutdown preserves named volumes. Data deletion remains a separate explicit maintenance action.
