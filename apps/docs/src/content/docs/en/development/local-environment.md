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

## Host readiness

- The complete Data profile runs databases, ClamAV, search, graph, and GIS together. `compose.yaml` is authoritative for resource bounds; confirm adequate Docker capacity and disk instead of relying on an unverified “minimum machine” number.
- Some images use explicit `linux/amd64` emulation on Apple Silicon, so the first pull, initialization, and health checks take longer.
- Installation and the first build need access to npm and container registries.
- Confirm the ports below are free from another process or old Compose project. When a port conflicts, identify the owner rather than changing one side and leaving callback, CORS, or smoke configuration inconsistent.

## Primary ports

| Service                                      | Local entrypoint                                     |
| -------------------------------------------- | ---------------------------------------------------- |
| Web                                          | `http://127.0.0.1:3000`                              |
| API / OpenAPI                                | `http://127.0.0.1:3001` / `/openapi.json`            |
| EXCON v1 compatibility worker health         | `http://127.0.0.1:3002/health/ready`                 |
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

The shared MCP process always initializes its EXCON HTTP client. Even Data-only MCP work configures a non-empty `AGENT_EXCON_API_KEY` plus complete `DATA_*`. Data Tools never send that EXCON key, so a local placeholder can satisfy Data-only process configuration; it is not unified identity and cannot call `excon_*`.

### Obtaining local identity

- A human developer signs in at `/en/login` with the seeded operator from Quick start. Web uses the Supabase session for Platform and Data pages.
- A Supabase human with `platform.delegation.manage` creates, issues, rotates, and revokes Agent/service delegated credentials through `/api/platform/v1/delegations`; plaintext is returned once.
- EXCON MCP `AGENT_EXCON_API_KEY` comes from a trusted Run staffing/bootstrap flow and is bound to one concrete RunAgent. No CLI turns the seeded password into a general EXCON token. Use the versioned Cookbook/Showcase for a bounded local collaboration session.
- `stack:full:up` does not automatically issue the EXCON live Web operator credential either. Its source depends on the selected operator workflow; preserve the unavailable state when no real credential exists.

See [Platform Auth](/en/architecture/unified-auth/), [Agent EXCON HTTP](/en/protocols/http/), and [MCP](/en/protocols/mcp/) for headers, scopes, and invocation order.

## Environment variables and secrets

`.env.example` is a variable catalog, not a production-ready configuration. The complete stack writes generated local secrets to ignored `.wiser/local/runtime-secrets.json`. Never commit `.env`, database URLs, S3 keys, Supabase service-role keys, HMAC keys, MCP tokens, or Codex login files.

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and a publishable key. Database, object-store, projection, and operator credentials remain server-side.

## Logs, stop, and reset

```bash
docker compose ps
docker compose logs --tail=200 api web worker docs data-worker mcp-http telemetry-ingress
pnpm data:logs
pnpm exec supabase status
pnpm data:down
pnpm observability:down
pnpm stack:down
```

Narrow `docker compose logs` to only the failed services; use `docker compose ps -a` when a container did not stay running. Supabase is CLI-managed and is not part of the root Compose project. `supabase status` confirms services and ports; inspect the named containers through the local Docker runtime for their logs.

| Operation                                 | Removes                                                      | Retains                                                    |
| ----------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- |
| `pnpm stack:down`                         | Stops/removes containers only                                | Compose named volumes, local Supabase data, `.wiser/local` |
| `pnpm supabase:reset` / `supabase:verify` | Rebuilds Supabase control, Auth/EXCON schemas, and seed data | Data Foundation volumes, `.wiser/local`                    |
| confirmation-gated `pnpm data:reset`      | Allowlisted Data PostgreSQL/S3/projection named volumes      | Supabase, observability volumes, `.wiser/local`            |
| `pnpm observability:down`                 | Stops observability services                                 | Tempo/Loki/Prometheus/Grafana named volumes                |

There is no “delete every local state” command. `.wiser/local/runtime-secrets.json` retains historical HMAC keys required to replay the EXCON journal. Never remove it or generate only a new key while that journal exists. Handle the file through the team's key-rotation process only after every service is stopped, the Supabase/EXCON journal is intentionally reset, and old records no longer need recovery. Data reset alone does not require its removal.

When the complete stack fails, check Docker resources, port conflicts, and failed-service logs before rerunning the convergent `pnpm stack:full:up`.
