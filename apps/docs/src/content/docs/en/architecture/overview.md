---
title: Architecture
description: Boundaries between the control plane, public API, EXCON domain, Supabase, AI, and MCP.
---

## Principle

Agent EXCON keeps uncertain agent behavior outside a deterministic environment boundary. State transitions, authorization, evidence visibility, events, and baseline adjudication are enforced by testable code and database constraints.

```text
Participant ── HTTP / SDK / MCP ──► Protocol API
                                      │
Next.js control plane ─────────────────┤
                                      ▼
                         EXCON domain state machine
                            │                  │
                            ▼                  ▼
                    PostgreSQL/Supabase    Evaluator adapters
                    Auth / RLS / Storage   Rules / AI / Human
```

## Responsibilities

| Component           | Owns                                                          | Does not own                              |
| ------------------- | ------------------------------------------------------------- | ----------------------------------------- |
| Next.js Web         | Chinese-default console, human review, replay                 | Public protocol and long jobs             |
| Fastify API         | `/api/v1`, authentication, idempotency, OpenAPI, transactions | Page rendering and model policy           |
| Worker              | Async evaluation, retries, outcome ingestion                  | Bypassing the state machine               |
| Supabase/PostgreSQL | Facts, locks, RLS, Auth, Storage                              | Natural-language verdicts                 |
| AI adapters         | Codex and OpenAI-compatible calls                             | Data authorization or rule overrides      |
| MCP Server          | Mapping stable HTTP operations to MCP                         | Business logic and direct database access |

## Shared contracts

Zod schemas in `packages/contracts` are reused by Fastify validation, OpenAPI, forms, jobs, SDKs, MCP, and fixtures. SQL migrations remain authoritative for foreign keys, checks, uniqueness, and transactions.

Normal row access uses the Supabase SDK. Complex transactions, row locks, `SKIP LOCKED`, and bulk operations use `pg` with explicit SQL/RPC. The initial queue is a PostgreSQL status table, not Redis.

## AI adapters

- **Codex local:** default for host-side development with ChatGPT subscription sign-in.
- **OpenAI-compatible:** deployment/provider mode with pinned endpoint, model, and capability set.
- **Fake:** deterministic default for unit, integration, and CI tests.

All adapters return normalized usage, latency, model identity, and trace metadata.

## Compose boundary

The official Supabase Compose commit and its image set are upgraded atomically. Application services layer on with multiple Compose files. Analytics/vector remain optional and are outside the first slice.

The initialization baseline is upstream Supabase commit [`9ae6e54`](https://github.com/supabase/supabase/commit/9ae6e54dd585fb7f71dfc6917ab9fc09fe3a408a), including `supabase/postgres:17.6.1.136` and `envoyproxy/envoy:v1.39.0`. The checked-in Compose files remain the runtime authority; an upgrade reviews every image in that upstream commit, not only these two examples.

New environments initialize directly on PostgreSQL 17. Importing PostgreSQL 15 data later requires backup and a rehearsed [official Supabase PG17 upgrade](https://supabase.com/docs/guides/self-hosting/postgres-upgrade-17); never start PG17 directly on a PG15 data volume.
