---
title: Quick start
description: Install dependencies from a clean checkout, start WISER, sign in, and confirm default services plus the Data verification path.
docType: workflow
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when first installing or starting the complete local WISER platform
whenToUpdate:
  - when prerequisites, complete-stack commands, sign-in, or primary entrypoints change
checkPaths:
  - package.json
  - compose.yaml
  - .env.example
  - scripts/data-foundation/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

This page covers the first complete run only. See the [local development environment](/en/development/local-environment/) for standalone frontend/backend commands, every port, environment variables, and troubleshooting.

## 0. Prerequisites

- Node.js 24; use the root `package.json` `engines` field for the exact range
- The repository-pinned pnpm provided by Corepack
- Docker Engine 29+ and Docker Compose 5+
- Git

Confirm Docker is running and allocate enough CPU, memory, and disk. Data Foundation starts database, object-store, search, graph, and GIS services.

## 1. Install

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Do not create a second lockfile in an application directory. Package manifests and the root `pnpm-lock.yaml` define npm versions; `compose.yaml` and `infrastructure/data-foundation/versions.env` define container versions.

## 2. Start the complete platform

```bash
pnpm stack:full:up
```

The command:

1. starts local Supabase Auth, control-plane PostgreSQL, Storage, and Studio;
2. creates ignored local runtime keys;
3. builds and starts API, Web, the Agent EXCON v1 compatibility/testing worker, and docs; that worker provides compatibility-process health and does not execute default v2 evaluation;
4. starts the Data Foundation profile and runs checksum migrations plus deterministic seed;
5. starts the Data worker, MCP gateway, and data infrastructure;
6. runs an end-to-end smoke across Data REST, GraphQL, MCP, and authenticated Web.

The default complete stack is ready only after the command succeeds. It neither reads nor mounts `~/.codex/auth.json`, and it never injects a Supabase service-role key into applications.

## 3. Open the entrypoints

| Purpose               | Address                                    |
| --------------------- | ------------------------------------------ |
| WISER home            | `http://127.0.0.1:3000/en`                 |
| Agent EXCON scenarios | `http://127.0.0.1:3000/en/scenarios`       |
| Agent EXCON runs      | `http://127.0.0.1:3000/en/runs`            |
| Data Foundation       | `http://127.0.0.1:3000/en/data-foundation` |
| Documentation         | `http://127.0.0.1:4321/en`                 |
| API readiness         | `http://127.0.0.1:3001/health/ready`       |
| OpenAPI               | `http://127.0.0.1:3001/openapi.json`       |
| GraphQL               | `POST http://127.0.0.1:3001/graphql`       |
| MCP Streamable HTTP   | `http://127.0.0.1:13004/mcp`               |
| Supabase Studio       | `http://127.0.0.1:56323`                   |

Sign in with the local fixture account:

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

This account and password are only for local seed data. Never copy them into a shared or production environment.

The complete stack injects a real local Supabase identity for Data Foundation Web and Data MCP. The shared MCP process also receives a local placeholder that is sufficient only to configure the EXCON client. Data Tools do not use it, but every `excon_*` call fails authentication until a real RunAgent-bound credential is supplied. Agent EXCON live Web still needs a server-side operator credential; missing or invalid identity produces an explicit unavailable state and never falls back to fabricated data.

## Verify the Agent EXCON protocol loop

Use an isolated local lab and four deterministic scripted RunAgents to verify EXCON HTTP/MCP, receipts, Barriers, collaboration, and evaluation without model use:

```bash
pnpm cookbook:scripted
```

This proves the Agent EXCON system but does not upgrade the complete-stack Web placeholder into a live operator/RunAgent identity. Real EXCON live clients still obtain dedicated credentials from a trusted Run staffing or operator workflow.

## 4. Stop

Stop Compose and Supabase while preserving data in named volumes:

```bash
pnpm stack:down
```

Stop only the Data Foundation profile:

```bash
pnpm data:down
```

Removing Data Foundation volumes is destructive and requires exact confirmation:

```bash
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

## Next steps

- [Development guide](/en/development/): choose complete-stack, standalone-application, or focused-test workflows
- [Platform architecture](/en/architecture/wiser-platform/): understand shared hosts and system authorities
- [Agent EXCON HTTP](/en/protocols/http/) and [MCP](/en/protocols/mcp/)
- [Data REST](/en/protocols/data-rest/), [GraphQL](/en/protocols/data-graphql/), and [MCP](/en/protocols/data-mcp/)
