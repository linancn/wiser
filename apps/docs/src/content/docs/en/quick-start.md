---
title: Quick start
description: Start and verify unified Auth, durable Agent EXCON v2, and the complete Data Foundation slice locally.
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when first installing, verifying, or starting the complete local WISER platform
whenToUpdate:
  - when toolchain, commands, ports, local identities, or service entrypoints change
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
  - packages/excon-scenarios/**
  - examples/agent-excon/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: dd8c0bb38e4d9d9a14e7c1c67d8b9752d04739a8
---

## Current runtime boundary

The complete local stack shares one Supabase Auth, Fastify API, Next.js Web, MCP server, and Fumadocs application:

- Agent EXCON v2 writes all 19 mutations to an append-only command journal in Supabase PostgreSQL and verifies deterministic replay with generation tapes and result hashes at startup. Only one non-superuser writer is allowed. v1 Episodes remain an explicit in-memory compatibility protocol.
- The bundled Yongding scenario comes from the validated runtime public exports of `@agent-excon/scenarios`. Executable four-agent Cookbooks and Showcases live under `examples/agent-excon/`; they are not API asset lookup paths.
- Data Foundation's 22 Capabilities are wired to independent data-postgres, SeaweedFS, concrete ingestion Worker, five projections, REST, GraphQL, MCP, Skill, and the unified Web query workspace.
- Data Web requires a real Supabase session. Its server-only DAL forwards the access token to the API; the browser never receives database, S3, or projection credentials.
- Chinese (`zh-CN`) is the default, English routes are isomorphic, and both systems share light/dark themes, semantic tokens, keyboard behavior, and responsive layout.

## Tool baseline

| Tool         | Repository baseline                                           |
| ------------ | ------------------------------------------------------------- |
| Node.js      | 24 LTS, `>=24.18.0 <25`                                       |
| pnpm         | `11.22.0`                                                     |
| TypeScript   | `7.0.2`; every application explicitly uses the TypeScript CLI |
| Docker       | Engine 29+ / Compose 5+                                       |
| Supabase CLI | Exact workspace pin                                           |
| Docpact      | `0.1.9`                                                       |

Key UI/data dependencies are exact too: AWS S3 SDK/presigner `3.1116.0`, Next.js `16.3.2`, Fumadocs core/UI `16.15.0`, Fumadocs MDX `15.3.1`, and MapLibre GL JS `6.5.0`. pnpm preserves the 24-hour supply-chain cooldown for all other packages and narrowly adds `minimumReleaseAgeExclude` only for this just-verified stable vendor set; the frozen lockfile still fixes every integrity hash.

Compatibility takes precedence over blindly following a major. GraphQL `16.14.2` with Mercurius `16.10.0` is the combination actually built under Fastify 5/TS7, and `@types/node` `24.13.3` matches the Node 24 runtime. GraphQL 17 or a newer Node type major is outside this delivery's compatibility boundary.

```bash
node --version
pnpm --version
docker compose version
```

## Install and static verification

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm supabase:verify
pnpm data:verify
```

`pnpm verify` checks formatting, lint, types, unit/integration tests, every workspace build, and Compose config. `supabase:verify` resets local Supabase and runs pgTAP, lint, and advisors. `data:verify` covers Data scripts, contracts/core/infra/Worker tests, types, builds, and profile config.

## Documentation governance

```bash
cargo install docpact --version 0.1.9
pnpm docpact:route --paths 'apps/api/src/data-foundation/**'
pnpm docpact:check
pnpm docpact:validate
```

Always route the actual change path. When `check` reports `review_or_update`, read and update the document or record explicit review only after confirming it remains accurate. Baselines and waivers are not routine bypasses.

## Start the complete platform with one command

```bash
pnpm stack:full:up
```

The command:

1. starts Supabase Auth/PostgreSQL/Storage/Studio;
2. reads publishable Supabase runtime information and signs in the seeded local operator;
3. creates or reuses local HMAC/database secrets in ignored `.wiser/local/runtime-secrets.json` with mode `0600`;
4. provisions journal login only for non-superuser `wiser_excon_api`, without injecting a service-role key;
5. builds one shared WISER application image and waits for default services plus the `data-foundation` profile;
6. runs checksum migrations, deterministic seed, and the 18-step Data smoke.

`.env` is optional for local overrides. The default complete stack does not require secrets to be written into the repository. Production must inject every credential from managed secret storage and must not reuse Compose defaults.

To observe each phase separately:

```bash
pnpm supabase:start
pnpm data:up
pnpm data:migrate
pnpm data:seed
pnpm data:smoke
```

`data:migrate` verifies `0001`–`0008` filenames and SHA-256 under a session advisory lock. `data:seed` is repeatable. `data:up` is also repeatable: OpenSearch ICU initialization, object-store bucket creation, and API/Worker/GIS runtime-role provisioning converge from existing state.

## Real 18-step smoke

`pnpm data:smoke` uses `sample-stations.geojson` and `sample-evidence.md` to prove, in order:

1. presigned upload Session creation;
2. both fixture uploads and Session completion;
3. ingestion creation and idempotent submit;
4. ClamAV scan;
5. SHA-256 fingerprints;
6. GeoJSON/Tika parsing;
7. fake-AI plan and controlled validation;
8. deterministic transformation;
9. quality checks;
10. human-gated immutable authority commit;
11. raw content promotion;
12. same-transaction Outbox write;
13. PostGIS, Weaviate, OpenSearch, Neo4j, and STAC projection builds;
14. five `projection_status=SUCCEEDED` rows;
15. REST catalog and federated search;
16. GraphQL catalog query;
17. MCP `data_catalog_get`;
18. the authenticated Chinese Web catalog plus replay of the same Outbox event without duplicates.

On failure, the script prints recent Data service, API, and Web logs. It does not write credentials or object bodies into its report.

## Local entrypoints

| Service                 | Address                                                           |
| ----------------------- | ----------------------------------------------------------------- |
| Web / Data Foundation   | `http://127.0.0.1:3000/zh-CN/data-foundation`                     |
| API / Data REST         | `http://127.0.0.1:3001` / `/api/data/v1`                          |
| GraphQL                 | `http://127.0.0.1:3001/graphql`                                   |
| Fumadocs                | `http://127.0.0.1:4321`                                           |
| Supabase Studio         | `http://127.0.0.1:56323`                                          |
| data-postgres           | `127.0.0.1:55432`                                                 |
| SeaweedFS S3            | `http://127.0.0.1:18333`                                          |
| Weaviate                | `http://127.0.0.1:18080`                                          |
| OpenSearch / Dashboards | `https://127.0.0.1:19200` / `http://127.0.0.1:15601`              |
| Neo4j HTTP              | `http://127.0.0.1:17474`                                          |
| Governed OGC / STAC     | `http://127.0.0.1:3001/api/data/v1/geo/ogc/...` / `/geo/stac/...` |
| Governed vector/raster  | `http://127.0.0.1:3001/api/data/v1/geo/tiles/...`                 |
| Tika / ClamAV           | `http://127.0.0.1:19998` / `127.0.0.1:13310`                      |
| Data Worker             | `http://127.0.0.1:13003/health/ready`                             |
| MCP Streamable HTTP     | `http://127.0.0.1:13004/mcp`                                      |

Every published host port binds to loopback. GeoServer, STAC API, TiTiler, and Martin publish no host port and are reachable only by Fastify after unified Auth, `data.geo.read`, RLS/version checks, and audit. Database/projection administration endpoints and credentials are never given to a browser or external Agent.

## Local sign-in and query workspace

The Supabase seed provides this local-fixture-only operator:

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

Sign in at `http://127.0.0.1:3000/zh-CN/login`. The Data workspace displays catalog items, versions, provenance/authorization, security, quality/acceptance, ingestion state, issues, Agent runs, Operation events, projection status, lineage, search, graph, and map views. DataItem detail switches immutable versions with `?version=<uuid>` and opens them on the map. The map accepts bbox, Version, and EPSG:4326/4490, with accessible controls for PostGIS authority, STAC extent, vector MVT, and raster layers. The browser reaches only a same-origin proxy; short-lived server Session and internal GIS addresses never enter the page. Invoke writes through [Data REST](/en/protocols/data-rest/), [Data GraphQL](/en/protocols/data-graphql/), [Data MCP](/en/protocols/data-mcp/), or `skills/wiser-data-foundation`.

## Use MCP separately

Both stdio and Streamable HTTP call only the HTTP API. Before a standalone start, obtain a real Supabase JWT or `wdc1.` delegated credential:

```bash
export DATA_API_URL=http://127.0.0.1:3001/api/data/v1/
export DATA_API_BEARER_TOKEN=<short-lived-bearer>
export DATA_TENANT_ID=<tenant-uuid>
export DATA_PROJECT_ID=<project-uuid>
export DATA_PURPOSE=data-steward-console

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

Streamable HTTP additionally requires `DATA_MCP_BEARER_TOKEN` at the `/mcp` boundary. It is not the downstream Data API identity.

## Stop and clean up

Stop only the Data profile while preserving API/Web and every named volume:

```bash
pnpm data:down
```

Stop all Compose services and Supabase:

```bash
pnpm stack:down
```

Only remove allowlisted Data Foundation volumes after exact confirmation:

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

The reset script verifies the Compose project and exact volume allowlist; it cannot delete Supabase or observability volumes.
