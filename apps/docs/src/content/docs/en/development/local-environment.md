---
title: Local development environment
description: Reference for WISER complete-stack, standalone-app, ports, identity, logs, stop, and reset workflows.
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when selecting a local runtime mode or diagnosing service startup
whenToUpdate:
  - when Compose profiles, ports, scripts, or environment variables change
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

## Runtime modes

| Mode              | Command                          | What it proves                                                                                       |
| ----------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Complete platform | `pnpm stack:full:up`             | Unified Auth, durable EXCON API, Data Foundation, Data MCP, and authenticated Web integration        |
| Base stack        | `pnpm stack:up`                  | Supabase plus default Compose; API uses local compatibility configuration and Data profile stays off |
| Data profile      | `pnpm data:up`                   | Default services and all Data infrastructure on top of a working local Supabase identity             |
| Observability     | `pnpm observability:up`          | Telemetry ingress and OTel/Grafana after the shared application image has been built                 |
| Standalone app    | Use the workspace commands below | UI, protocol, or unit-test loops                                                                     |

`data:up` is not a platform-independent data stack. It reads running local Supabase status, signs in the seeded operator, and converges default application services together with the Compose profile. Prefer `stack:full:up` on a clean machine.

## Primary ports

| Service                                      | Local entrypoint                                     |
| -------------------------------------------- | ---------------------------------------------------- |
| Web                                          | `http://127.0.0.1:3000`                              |
| API / OpenAPI                                | `http://127.0.0.1:3001` / `/openapi.json`            |
| Agent EXCON worker health                    | `http://127.0.0.1:3002/health/ready`                 |
| Docs                                         | `http://127.0.0.1:4321`                              |
| Data worker health                           | `http://127.0.0.1:13003/health/ready`                |
| MCP HTTP                                     | `http://127.0.0.1:13004/mcp`                         |
| Supabase API / PostgreSQL / Studio / Mailpit | `56321` / `56322` / `56323` / `56324`                |
| data-postgres                                | `127.0.0.1:55432`                                    |
| SeaweedFS S3                                 | `http://127.0.0.1:18333`                             |
| Weaviate                                     | `http://127.0.0.1:18080`                             |
| OpenSearch / Dashboards                      | `https://127.0.0.1:19200` / `http://127.0.0.1:15601` |
| Neo4j HTTP                                   | `http://127.0.0.1:17474`                             |
| Tika / ClamAV                                | `http://127.0.0.1:19998` / `127.0.0.1:13310`         |
| Telemetry ingress / Grafana / Prometheus     | `14318` / `3300` / `9090`                            |
| OTel gRPC / HTTP / health                    | `4317` / `4318` / `13133`                            |

GeoServer, STAC API, TiTiler, and Martin have no host port. They are reachable only through the API proxy after unified authorization.

## Standalone application commands

Start only what you need in separate terminals:

```bash
pnpm --filter @wiser/api dev
pnpm --filter @wiser/web dev
pnpm --filter @wiser/docs dev
```

Use `pnpm dev` to run all three in parallel: Web is fixed to `3000`, API defaults to `3001`, and Docs is fixed to `4321`. Without production configuration, API uses the local compatibility combination of Auth off, Agent EXCON memory, and Data Foundation off. It is useful for protocol and UI loops, but it does not verify unified Auth, database durability, or Data behavior.

## Identity boundary

Data Foundation Web uses the Supabase SSR session, and the complete stack injects a local operator JWT for Data smoke and Data MCP. Agent EXCON live Web still reads its operator credential from server-side `WISER_WEB_OPERATOR_TOKEN`; EXCON MCP still needs `AGENT_EXCON_API_KEY` bound to one concrete RunAgent. A healthy process therefore does not prove these two EXCON clients have valid identity. Preserve explicit unavailable/authentication errors.

The shared MCP process always initializes its EXCON HTTP client. Even Data-only MCP work currently requires a valid `AGENT_EXCON_API_KEY` in addition to the complete `DATA_*` configuration. Never treat a Compose placeholder token as a unified-Auth credential.

## Environment variables and secrets

`.env.example` is a variable catalog, not a production-ready configuration. The complete stack writes generated local secrets to ignored `.wiser/local/runtime-secrets.json`. Never commit `.env`, database URLs, S3 keys, Supabase service-role keys, HMAC keys, MCP tokens, or Codex login files.

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and a publishable key. Database, object-store, projection, and operator credentials remain server-side.

## Logs, stop, and reset

```bash
pnpm data:logs
pnpm observability:smoke
pnpm data:down
pnpm stack:down
```

When the complete stack fails, check Docker resources, port conflicts, and failed-service logs before rerunning the convergent `pnpm stack:full:up`. `pnpm supabase:verify` resets the local Supabase database. Use the confirmation-gated `data:reset` from Quick start only when discarding local Data Foundation state is intentional.
