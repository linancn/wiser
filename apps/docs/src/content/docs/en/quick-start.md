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

## Exercise the first loop

The participant loads `skills/agent-excon` and runs the exercise through HTTP or MCP. Web is a read-only case, status, and trace visualization; it does not submit or advance Episodes.

1. Create an Episode from the synthetic Yongding River multi-source dispatch scenario.
2. Read released source availability, control targets, and monitoring observations.
3. Submit a staged source-allocation and release plan with evidence references.
4. Retrieve deterministic evaluation and structured feedback.
5. Read the Event stream and verify the run can be replayed.

See the [HTTP protocol](/en/protocols/http/) for payloads and the [Yongding River dispatch](/en/scenarios/yongding-river-dispatch/) for acceptance criteria.

Stop services with `pnpm stack:down`. Normal shutdown retains named volumes; data deletion must remain an explicit maintenance operation.
