---
title: WISER repository entrypoint
docType: overview
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when first understanding, starting, or navigating the WISER repository
whenToUpdate:
  - when system boundaries, application processes, commands, or public entrypoints change
checkPaths:
  - apps/**
  - packages/**
  - examples/**
  - compose.yaml
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: ccd874eda8e16f8fd9169ec2f2769ff17f287c48
---

# WISER · Water Intelligence System & Engine for Reconfiguration

English · [中文（默认）](./README.md)

**wiser water, better future**

WISER is a multi-system platform for water-intelligence products. Its business systems share Supabase Auth, the Web shell, API host, MCP gateway, documentation, design language, and observability while retaining independent domain contracts, cores, workers, and data authorities.

## Systems and entrypoints

| System          | Human-facing frontend                                 | Public backend entrypoint                              | Primary source                                                                                          |
| --------------- | ----------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| WISER Platform  | Sign-in, user controls, and shared shell: `/en/login` | Identity and delegation: `/api/platform/v1`            | `packages/platform-*`, `apps/api/src/platform`, `apps/web/src/components/platform`, `supabase`          |
| Agent EXCON     | Scenarios and runs: `/en/scenarios`, `/en/runs`       | HTTP: `/api/v2`; MCP: `/mcp`                           | `packages/contracts`, `packages/core`, `packages/infra`, `packages/excon-scenarios`, `apps/worker`      |
| Data Foundation | Data workspace: `/en/data-foundation`                 | REST: `/api/data/v1`; GraphQL: `/graphql`; MCP: `/mcp` | `packages/data-*`, `apps/api/src/data-foundation`, `apps/data-worker`, `infrastructure/data-foundation` |

Browsers, Skills, and MCP clients access business capabilities through HTTP boundaries. They never connect directly to databases, object storage, or projections. See the [platform architecture](./apps/docs/src/content/docs/en/architecture/wiser-platform.md) for system-level boundaries.

## Application processes

| Path                     | Type             | Responsibility                                                           | Complete-stack entrypoint             |
| ------------------------ | ---------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `apps/web`               | Frontend         | WISER product UI; Chinese default, English and light/dark themes         | `http://127.0.0.1:3000/zh-CN`         |
| `apps/docs`              | Frontend         | Fumadocs site for every WISER system                                     | `http://127.0.0.1:4321`               |
| `apps/api`               | Backend          | Shared Fastify host for Platform, Agent EXCON, and Data Foundation       | `http://127.0.0.1:3001`               |
| `apps/worker`            | Backend worker   | Deterministic Agent EXCON evaluation jobs                                | `http://127.0.0.1:3002/health/ready`  |
| `apps/data-worker`       | Backend worker   | Data ingestion, quality, publication, and projection jobs                | `http://127.0.0.1:13003/health/ready` |
| `apps/mcp`               | Protocol gateway | Maps Agent EXCON and Data Foundation MCP tools to HTTP APIs              | `http://127.0.0.1:13004/mcp`          |
| `apps/telemetry-ingress` | Optional backend | Authenticates, limits, and redacts external RunAgent OTLP/HTTP telemetry | `http://127.0.0.1:14318`              |

See the [local development environment](./apps/docs/src/content/docs/en/development/local-environment.md) for Supabase Studio, database, object-store, search/GIS, and observability ports.

## Start in five minutes

Install Node.js 24, Corepack, Docker Engine, and Docker Compose. Treat [`package.json`](./package.json) as the source of truth for supported versions.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm stack:full:up
```

The first image build and end-to-end smoke can take time. After the command succeeds, open:

- Product UI: <http://127.0.0.1:3000/zh-CN>
- Documentation: <http://127.0.0.1:4321>
- API readiness: <http://127.0.0.1:3001/health/ready>
- Supabase Studio: <http://127.0.0.1:56323>

The seeded account is for local fixtures only:

```text
operator@agent-excon.test
WiserLocalOperator-2026!
```

Stop services while retaining local data:

```bash
pnpm stack:down
```

See [Quick start](./apps/docs/src/content/docs/en/quick-start.md) for staged startup, logs, reset behavior, and troubleshooting.

## Develop and verify

API, Web, and docs can run independently when the complete infrastructure is unnecessary. The [development guide](./apps/docs/src/content/docs/en/development/index.md) defines exact commands and capability boundaries for each mode. The primary pre-commit gate is:

```bash
pnpm verify
```

Database changes also require focused integration gates. Note that `supabase:verify` resets the local Supabase database:

```bash
pnpm supabase:verify
pnpm data:verify
```

The repository uses Red → Green → Refactor, small commits, and Docpact governance. See [`CONTRIBUTING.md`](./CONTRIBUTING.md) for the complete workflow.

## Repository layout

```text
apps/           Runnable frontends, API, protocol gateway, and workers
packages/       Platform/system contracts, pure cores, adapters, and runtime assets
examples/       Executable tutorials, labs, and showcases grouped by system
infrastructure/ Docker, Data Foundation, and observability infrastructure
skills/         Agent Skills that use WISER through public protocols
supabase/       Unified Auth, platform control plane, and Agent EXCON database assets
tests/          Cross-application, toolchain, and acceptance tests
```

Dependency direction is `platform contracts <- system contracts <- core <- application <- infra/apps`. New systems join the shared hosts and must not import another system's core or infrastructure.

## Documentation

- [Documentation home](./apps/docs/src/content/docs/en/index.mdx)
- [Quick start](./apps/docs/src/content/docs/en/quick-start.md)
- [Development guide](./apps/docs/src/content/docs/en/development/index.md)
- [Platform architecture](./apps/docs/src/content/docs/en/architecture/wiser-platform.md)
- [Interface navigation](./apps/docs/src/content/docs/en/protocols/meta.json)

Every documentation page has an English and Chinese version at the same locale-free slug. `apps/docs` is the human-facing source of truth; component READMEs cover only the responsibility and direct commands for their directory.

## License and security

Code is available under the [MIT License](./LICENSE). Scenario data and third-party material retain the terms in their `PROVENANCE.md`. Never expose local Supabase, database, object-store, or development credentials. See [`SECURITY.md`](./SECURITY.md) for private reporting guidance.
