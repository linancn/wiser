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
lastReviewedAt: 2026-09-08
lastReviewedCommit: 4d8a440d12ab9e554934b531bb3c781134966e6c
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

Local development must load `compose.override.yaml`, including when using an explicit file list: `docker compose -f compose.yaml -f compose.override.yaml ...`. If a case/runtime file is also needed, retain the local override and review the merge order and effective configuration before starting, rebuilding, or recreating services. Preserve manual local changes; do not silently replace their ports, source mounts, or development commands. Use the same file list for configuration checks and the subsequent Compose operation. `docker compose ... config --quiet` validates the configuration without printing resolved secrets.

- The complete Data profile runs databases, ClamAV, search, graph, and GIS together. `compose.yaml` is authoritative for resource bounds; confirm adequate Docker capacity and disk instead of relying on an unverified “minimum machine” number.
- Some images use explicit `linux/amd64` emulation on Apple Silicon, so the first pull, initialization, and health checks take longer.
- Installation and the first build need access to npm and container registries.
- The OpenSearch one-shot init downloads and verifies the official `analysis-icu` and `analysis-smartcn` plugins at the exact 3.8.0 version; readiness requires both. Each plugin uses a named volume. A plugin version or checksum change is applied through a confirmation-gated Data reset in disposable state, followed by rebuilding the versioned search projections from authority.
- With the Data profile enabled, API startup waits for that initializer to export the OpenSearch CA. Node loads `NODE_EXTRA_CA_CERTS` when its process starts, so creating the file afterward cannot repair an already-running API. This dependency is optional when the Data profile is disabled, keeping the base stack independent.
- Confirm the ports below are free from another process or old Compose project. When a port conflicts, identify the owner rather than changing one side and leaving callback, CORS, or smoke configuration inconsistent.

## Primary ports

| Service                                      | Local entrypoint                                     |
| -------------------------------------------- | ---------------------------------------------------- |
| Web                                          | `http://127.0.0.1:3100`                              |
| API / OpenAPI                                | `http://127.0.0.1:3101` / `/openapi.json`            |
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

Web and API use host ports `3100` and `3101` in both Compose and standalone development. Compose keeps their internal ports at `3000` and `3001`. Reference browser tests use `3200`, the standalone EXCON Lab defaults to `3201`, and standalone MCP HTTP defaults to `3004`. Supabase Auth redirects use the Web origin on `3100`; no local port override is required.

## Standalone application commands

Start only what you need in separate terminals:

```bash
pnpm --filter @wiser/api dev
pnpm --filter @wiser/web dev
pnpm --filter @wiser/docs dev
```

Use `pnpm dev` to run all three in parallel: Web is fixed to `3100`, API defaults to `3101`, and Docs is fixed to `4321`. Without production configuration, API uses the local compatibility combination of Auth off, Agent EXCON memory, and Data Foundation off. It is useful for protocol and UI loops, but it does not verify unified Auth, database durability, or Data behavior.

## Identity boundary

Data Foundation Web uses the Supabase SSR session, and the complete stack injects a local operator JWT for Data smoke and Data MCP. Agent EXCON live Web forwards the verified current Supabase user session; `WISER_WEB_OPERATOR_TOKEN` is limited to local Auth-off preview. EXCON MCP still needs `AGENT_EXCON_API_KEY` bound to one concrete RunAgent. A healthy process therefore does not prove these two EXCON clients have valid identity. Preserve explicit unavailable/authentication errors.

The shared MCP process always initializes its EXCON HTTP client. Even Data-only MCP work configures a non-empty `AGENT_EXCON_API_KEY` plus complete `DATA_*`. Data Tools never send that EXCON key, so a local placeholder can satisfy Data-only process configuration; it is not unified identity and cannot call `excon_*`.

### Obtaining local identity

- A human developer signs in at `/en/login` with the seeded operator from Quick start. Web uses the Supabase session for Platform and Data pages.
- A Supabase human with `platform.delegation.manage` creates, issues, rotates, and revokes Agent/service delegated credentials through `/api/platform/v1/delegations`; plaintext is returned once.
- EXCON MCP `AGENT_EXCON_API_KEY` comes from a trusted Run staffing/bootstrap flow and is bound to one concrete RunAgent. No CLI turns the seeded password into a general EXCON token. Use the versioned Cookbook/Showcase for a bounded local collaboration session.
- EXCON live Web reuses the signed-in user session and requires that user to have operator authorization. It does not need a separately issued Web operator token in Supabase mode.

See [Platform Auth](/en/architecture/unified-auth/), [Agent EXCON HTTP](/en/protocols/http/), and [MCP](/en/protocols/mcp/) for headers, scopes, and invocation order.

## Environment variables and secrets

Web and Docs use the public `WISER_AGENT_SETUP_URL` for their copyable Agent instructions; its local default is `http://127.0.0.1:3101/agent-setup/prompt.md`. Point it to the deployment's public API and supply it during production Docs builds. The API's `DATA_PUBLIC_API_ORIGIN` controls content-pinned Skill download URLs. See [Agent setup](/en/protocols/agent-setup/) for release verification and the separate authenticated connection.

The Data Foundation Skill's research-bundle helper uses Python 3 with the standard library. Its inventory phase checks package/download manifests, joins registered interfaces to the full source catalog, and accounts for unlisted files without changing the source directory. Run `python3 -B skills/wiser-data-foundation/scripts/water_bundle.py inventory --bundle /absolute/source --out /absolute/output/inventory.json`. This is local preparation; only the unified HTTP API may perform business ingestion. The Skill reference documents credential exclusions, sanitized derivatives, completeness and the opt-in real-case test.

Compose defaults `DATA_INGESTION_MAX_OBJECT_BYTES` to 64 MiB and honors an explicit environment override. This covers the research case's largest 36,378,636-byte file. It is the Worker's per-object bound; source registration still verifies exact bytes and does not turn partial or unparsed content into analytical data.

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

The Data profile builds `source-parser` and connects it only to the worker on the internal `data-parser` network. It has no host port, database credentials or outbound network access; the filesystem is read-only and temporary files live in bounded memory storage. `DATA_ANALYSIS_PARSER_URL` is optional for a host-only worker; without it, external formats remain explicitly unavailable. The profile configures it automatically. CI runs parser tests in the pinned GDAL image.

## Semantic embeddings and index cutover

Use the same `DATA_EMBEDDING_*` settings for API and Data Worker. Keep `fake` for CI and repeatable smoke; `NODE_ENV=production` requires an explicit real provider. Qwen3-Embedding-8B is supported through an OpenAI-compatible `/v1/embeddings` endpoint. Set the server address in private deployment configuration; the browser never receives it or its optional API key.

```dotenv
DATA_EMBEDDING_PROVIDER=openai-compatible
DATA_EMBEDDING_BASE_URL=http://embedding.internal:7710/v1
DATA_EMBEDDING_MODEL=Qwen/Qwen3-Embedding-8B
DATA_EMBEDDING_VERSION=1.0.0-qwen3
DATA_EMBEDDING_DIMENSIONS=4096
DATA_EMBEDDING_API_KEY=
DATA_EMBEDDING_TIMEOUT_MS=15000
```

An omitted/empty `DATA_EMBEDDING_QUERY_INSTRUCTION` selects the versioned English retrieval instruction. It is applied only to queries. The adapter requires the response model to match, checks exactly 4,096 finite nonzero vector values for this profile, and normalizes them. A call accepts at most 16 documents of 32,768 characters each and a 4 MiB response; excess input fails explicitly. No prompt or upstream response is written to logs.

Changing model, revision, dimensions or query instruction derives a new `WiserEvidenceChunkV3_*` collection. The revision is operator-managed: bump it when the served weights or preprocessing change. Keep API on the previous profile while preparing the target. Run the Worker rebuild against the new profile using the same Compose files as the running case, including `compose.override.yaml`; supply temporary new-profile environment only to the rebuild process when staging.

```bash
# Include the running case/runtime file as well when that deployment uses one.
docker compose -f compose.yaml -f compose.override.yaml run --rm --no-deps \
  data-worker pnpm --filter @wiser/data-worker exec tsx src/embedding-rebuild-cli.ts
```

The CLI uses the Worker's explicit tenant/project/security/policy scope, a per-profile/project advisory lock, immutable authority evidence, deterministic projection IDs and an independent consumer checkpoint. It writes only the target Weaviate collection and its rebuild checkpoint; it does not reset ingestion/publication state or replay other projections. Interrupted/failed events do not advance the checkpoint. Resume with the same profile. Verify the completed evidence coverage, model identity and Chinese/English real-case queries before recreating API and Worker with matching new settings. Keep the old collection for rollback; reverting both configurations restores its read/write path. Existing source-registration content does not become scientific evidence merely because its embeddings improve.
