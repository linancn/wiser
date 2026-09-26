---
title: Quick start
description: Start an isolated local WISER stack from a clean checkout, sign in, and confirm the data and exercise entrypoints.
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
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

Use this page when running WISER in your own development environment for the first time. For public data access or external-client connection, see the [public use guide](/en/development/wiser-data-guide/). For standalone applications, ports, configuration, and troubleshooting, see the [local development environment](/en/development/local-environment/).

## 0. Prerequisites

- Node.js 24; use the root `package.json` `engines` field for the exact range
- The repository-pinned pnpm provided by Corepack
- Docker Engine 29+ and Docker Compose 5+
- Git

Confirm Docker is running and allocate enough CPU, memory, and disk. The complete stack includes database, file storage, search, graph, and map services.

## 1. Install

From the repository root:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run these commands from the repository root. Do not create a second lockfile in an application directory.

## 2. Start the complete platform

```bash
pnpm stack:full:up
```

This starts local sign-in, the product web app, API, documentation, agent entrypoint, and Data Foundation services. It prepares isolated local test data and checks the web and protocol paths. Open the entrypoints below **after the command succeeds**. If it fails, follow the terminal message and use the [local environment guide](/en/development/local-environment/) for service logs and recovery.

## 3. Open the entrypoints

| Purpose               | Address                                    |
| --------------------- | ------------------------------------------ |
| WISER Portal          | `http://127.0.0.1:3100/en`                 |
| Agent EXCON scenarios | `http://127.0.0.1:3100/en/scenarios`       |
| Agent EXCON runs      | `http://127.0.0.1:3100/en/runs`            |
| Data Foundation       | `http://127.0.0.1:3100/en/data-foundation` |
| Documentation         | `http://127.0.0.1:4321/en`                 |
| API readiness         | `http://127.0.0.1:3101/health/ready`       |
| OpenAPI               | `http://127.0.0.1:3101/openapi.json`       |
| GraphQL               | `POST http://127.0.0.1:3101/graphql`       |
| MCP Streamable HTTP   | `http://127.0.0.1:13004/mcp`               |
| Supabase Studio       | `http://127.0.0.1:56323`                   |

These addresses are for local development only. Do not use the local test account on the public service; see the [data access guide](/en/development/wiser-data-guide/) for public entrypoints and account access.

Sign in with the local test account:

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

This account exists only in local test data. After sign-in, choose Data Foundation or Agent EXCON; the current account determines visible projects and content. Agents joining an exercise over MCP need a separate exercise participant identity; see [Agent EXCON MCP](/en/protocols/mcp/).

## Verify an agent exercise

Use a local synthetic scenario and scripted agents to check task delivery, collaboration, submission, evaluation, and replay. This command does not call a paid model:

```bash
pnpm cookbook:scripted
```

After it succeeds, review the corresponding collaboration and evaluation records in the exercise run workspace. See [Agent EXCON HTTP](/en/protocols/http/) and [MCP](/en/protocols/mcp/) for protocol fields and participant identity.

## 4. Stop

Stop Compose and Supabase while preserving data in named volumes:

```bash
pnpm stack:down
```

Stop only the Data Foundation profile:

```bash
pnpm data:down
```

Before clearing local data, read the reset scope and confirmation requirements in [Database development](/en/development/databases/).

## Next steps

- [Development guide](/en/development/): choose complete-stack, standalone-application, or focused-test workflows
- [Platform architecture](/en/architecture/wiser-platform/): understand shared hosts and system authorities
- [Agent EXCON HTTP](/en/protocols/http/) and [MCP](/en/protocols/mcp/)
- [Data REST](/en/protocols/data-rest/), [GraphQL](/en/protocols/data-graphql/), and [MCP](/en/protocols/data-mcp/)
