---
title: Architecture
description: Boundaries between the control plane, public API, EXCON domain, Supabase, AI, and MCP.
---

## Principle

Agent EXCON keeps uncertain agent behavior outside a deterministic environment boundary. State transitions, authorization, evidence visibility, events, and baseline adjudication are enforced by testable code and database constraints.

```text
Participant + Agent EXCON Skill ── HTTP / MCP ──► Protocol API
                                      │
Next.js read-only case and trace view ◄─┤
                                      ▼
                         EXCON domain state machine
                            │                  │
                            ▼                  ▼
                    PostgreSQL/Supabase    Evaluator adapters
                    Auth / RLS / Storage   Rules / AI / Human
```

## Responsibilities

| Component           | Owns                                                          | Does not own                                   |
| ------------------- | ------------------------------------------------------------- | ---------------------------------------------- |
| Next.js Web         | Chinese-default case visualization, status, trace, and replay | Submitting, advancing, or controlling Episodes |
| Fastify API         | `/api/v1`, authentication, idempotency, OpenAPI, transactions | Page rendering and model policy                |
| Worker              | Async evaluation, retries, outcome ingestion                  | Bypassing the state machine                    |
| Supabase/PostgreSQL | Facts, locks, RLS, Auth, Storage                              | Natural-language verdicts                      |
| AI adapters         | Codex and OpenAI-compatible calls                             | Data authorization or rule overrides           |
| MCP Server          | Mapping stable HTTP operations to MCP                         | Business logic and direct database access      |

## Shared contracts

Zod schemas in `packages/contracts` are reused by Fastify validation, OpenAPI, read projections, jobs, MCP, and fixtures. SQL migrations remain authoritative for foreign keys, checks, uniqueness, and transactions.

Normal row access uses the Supabase SDK. Complex transactions, row locks, `SKIP LOCKED`, and bulk operations use `pg` with explicit SQL/RPC. The initial queue is a PostgreSQL status table, not Redis.

## AI adapters

- **Codex local:** default for host-side development with ChatGPT subscription sign-in.
- **OpenAI-compatible:** deployment/provider mode with pinned endpoint, model, and capability set.
- **Fake:** deterministic default for unit, integration, and CI tests.

All adapters return normalized usage, latency, model identity, and trace metadata.

## Compose boundary

Development is deliberately split into two layers. Supabase CLI manages the official compatible local set of Auth, PostgreSQL 17, Storage, PostgREST, and Studio containers. The repository `compose.yaml` manages API, read-only Web, Worker, and docs with application health checks. This avoids copying a partial self-host stack that drifts as Supabase gateways and images change.

Production uses Supabase Platform or an atomically pinned official self-host Compose commit and complete image set. Never upgrade Auth, database, Storage, or gateway independently. Importing PostgreSQL 15 data requires backup and a rehearsed [official Supabase PG17 upgrade](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17); never start PG17 on a PG15 data volume.
