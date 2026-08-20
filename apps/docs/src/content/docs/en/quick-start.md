---
title: Quick start
description: Start the first runnable Agent EXCON loop locally.
---

## Baseline

Use Node.js 24 LTS, pnpm 11, Docker Compose v5, and a local Codex CLI signed in with ChatGPT.

```bash
node --version
pnpm --version
docker compose version
codex login status
```

## Install and verify

```bash
pnpm install
pnpm verify
```

Run only the documentation app with `pnpm --filter @agent-excon/docs dev`.

## Start support services

```bash
pnpm stack:up
```

Supabase CLI manages the official compatible local platform containers; Compose manages API, read-only Web, Worker, and docs. The local stack binds to loopback and must not be exposed publicly. Production uses Supabase Platform or an atomically pinned complete official self-host stack.

Use the workspace Supabase CLI for migrations and generated types:

```bash
pnpm exec supabase migration list --local
pnpm exec supabase gen types --lang typescript --local
```

## Select an AI mode

**Local development:** run Codex SDK/CLI on the host and reuse the ChatGPT sign-in. Do not mount `~/.codex` into shared application containers.

**Deployment and controlled integration:** use the OpenAI-compatible adapter with an explicit base URL, API key, and pinned model.

**Tests and CI:** use the deterministic fake provider. Live models are limited to opt-in smoke tests.

## Start the optional observability stack

```bash
pnpm observability:up
```

This starts the Telemetry Ingress plus pinned patch releases of OTel Collector, Tempo, Prometheus, Loki, and Grafana. Grafana is available at `http://127.0.0.1:3300`; participant OTLP/HTTP enters through `http://127.0.0.1:14318`, while trusted platform OTLP uses `4317/4318`. External agents cannot connect directly to the Collector.

Stop the profile while preserving its named volumes with `pnpm observability:down`.

## Exercise the v1 compatibility loop

The participant loads `skills/agent-excon` and runs the exercise through HTTP or MCP. This executable path is the v1 compatibility slice; the scenario center and multi-agent trace/replay are the v2 reference UI. Web never acts as a participant.

1. Create a compatibility Episode from the synthetic Yongding River multi-source dispatch scenario.
2. Read released source availability, control targets, and monitoring observations.
3. Submit a staged source-allocation and release plan with evidence references.
4. Retrieve deterministic evaluation and structured feedback.
5. Read the Event stream and verify the run can be replayed.

See the [HTTP protocol](/en/protocols/http/) for payloads and the [Yongding River dispatch](/en/scenarios/yongding-river-dispatch/) for acceptance criteria.

v2 maps this Episode to an `ExerciseRun`, one legacy `RunAgent`, and one Task per phase. Newly published scenarios require multiple roles. See [multi-agent control and observability](/en/architecture/multi-agent-observability/).

Stop services with `pnpm stack:down`. Normal shutdown retains named volumes; data deletion must remain an explicit maintenance operation.
