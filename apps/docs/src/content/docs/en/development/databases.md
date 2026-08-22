---
title: Database development
description: Choose the correct migration, RLS, seed, and verification workflow for the WISER Supabase control plane or independent Data Foundation database.
docType: workflow
scope: repository-databases
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing the Auth, platform control-plane, Agent EXCON, or Data Foundation data model
  - when implementing migrations, RLS, seeds, transactions, or Outbox behavior
whenToUpdate:
  - when database boundaries, migration runners, runtime roles, seeds, or verification commands change
checkPaths:
  - supabase/**
  - infrastructure/data-foundation/postgres/**
  - packages/data-infra/src/migrations/**
  - scripts/data-foundation/**
  - compose.yaml
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Start with the two PostgreSQL boundaries

WISER uses one Supabase Auth authority, but it does not put all business data in one database. The two PostgreSQL responsibilities and migration histories must stay independent.

| Boundary                                  | Owned data                                                                                                                                       | Canonical locations                                                                       | Migration and verification                                                                       |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Supabase Auth and control plane           | `auth.users`, sessions, actors, tenants, projects, memberships, roles, scopes, delegations, plus Agent EXCON facts and private journals/outboxes | `supabase/migrations`, `supabase/schemas`, `supabase/seed.sql`, `supabase/tests/database` | Supabase CLI, declarative schema, seed, pgTAP, lint, and advisors                                |
| Data Foundation `data-postgres` / PostGIS | DataItem, Version, Asset, Ingestion, Quality, Lineage, Knowledge, Operation, Audit, Outbox, and spatial authority facts                          | `infrastructure/data-foundation/postgres/migrations`                                      | WISER checksum runner, PostgreSQL advisory lock, deterministic seed, scripts, and vertical smoke |

Data Foundation stores only scoped subject, tenant, and project references supplied by the authorization context. It creates no user, session, membership, role, or token authority. Supabase migrations must not create Data Foundation business tables. The databases share no migration ledger, and no database transaction can be presented as covering both.

## Choose the change location

- Changes to login, sessions, tenants/projects, memberships, roles/scopes, delegated credentials, or durable Agent EXCON Runs belong under `supabase`.
- Data catalog, ingestion, quality, lineage, knowledge, operations, projection coordination, and PostGIS authority facts belong in `data-postgres`.
- If a use case crosses both boundaries, commit the authoritative change and Outbox in the owning database, then propagate through idempotent consumers. Do not implement a pretend cross-database transaction in application code.
- S3, Weaviate, OpenSearch, Neo4j, and STAC are object or projection targets, not identity or publication authorities. Their writes must not be presented as an atomically committed part of a PostgreSQL transaction.

## Supabase change workflow

Keep all four Supabase artifacts synchronized: ordered migrations are replayable history, declarative schemas describe the current shape, seeds establish deterministic local identities and cases, and pgTAP proves structure, security, and data invariants.

1. Start local Supabase:

   ```bash
   pnpm supabase:start
   ```

2. Add a pgTAP case under `supabase/tests/database` that fails because the intended behavior does not exist yet.
3. Create the migration with the repository-pinned Supabase CLI; do not handcraft timestamped filenames:

   ```bash
   pnpm exec supabase migration new <descriptive_name>
   ```

4. Implement the change in the new migration and synchronize the final shape into the correct declarative schema:

   - `00_agent_excon.sql`: v1 Agent EXCON relations;
   - `01_multi_agent_run.sql`: v2 Runs, Tasks, Receipts, journals, and private EXCON facts;
   - `02_platform_auth.sql`: unified identity, tenants/projects, authorization, and delegation.

5. If local development identities or deterministic cases need new data, update `supabase/seed.sql`. Seeds must be repeatable, contain no real credentials, and agree with the pgTAP assertions.
6. Run the complete gate:

   ```bash
   pnpm supabase:verify
   ```

`supabase:verify` first executes `db reset --local`, then runs pgTAP, database lint, and all advisors. It deletes local Supabase data; never point it at a shared or production database. Never rename, reorder, or edit a migration that has entered history. Append another migration instead.

## Data Foundation change workflow

`infrastructure/data-foundation/postgres/migrations` is the sole Data Foundation business-schema history. Filenames are unique, contiguous `NNNN_descriptive_name.sql` entries and are append-only.

1. Add a failing test for the intended invariant. SQL shape, runner, and repository tests live under `packages/data-infra/test`; deployment workflow tests live in `scripts/data-foundation/*.test.mjs`.
2. Append a migration. The runner orders files by their four-digit versions, calculates SHA-256, acquires a session advisory lock, applies each file in its own transaction, and records version, filename, and checksum in `public.schema_migrations`.
3. Apply migrations after starting the profile:

   ```bash
   pnpm data:up
   pnpm data:migrate
   ```

   `data:migrate` runs the WISER authority migrations, the pinned pyPgSTAC migrations, and runtime-role provisioning in order. The runner fails closed if an applied file is missing, renamed, has a changed checksum, or no longer forms a contiguous prefix.

4. If the fixed case changes, update the provenance-bearing synthetic fixtures in `tests/fixtures/data-foundation`, their expected checksums, and the seed builder, then run:

   ```bash
   pnpm data:seed
   ```

5. Run the static and workspace gate before the live vertical check:

   ```bash
   pnpm data:verify
   pnpm data:smoke
   ```

`data:verify` checks migration/operations script tests, test/typecheck/build for the four Data workspaces, and Compose configuration. It does not start a database, apply migrations, or execute the vertical smoke. `data:smoke` requires healthy services, applied migrations, and a loaded seed. Use `pnpm stack:full:up` when the complete path must be proven from a clean environment.

## RLS and runtime roles

An `authenticated` role alone is not authorization. Policies check ownership and live scope. Hidden outcomes, credentials, jobs, audits, idempotency records, and outboxes belong in private schemas and retain RLS, least-privilege grants, and immutability constraints as defense in depth.

The Supabase EXCON journal is accessed by the non-superuser, `NOBYPASSRLS` `wiser_excon_api` through the least-privilege `wiser_excon_runtime` group. Browsers use Supabase sessions; service-role and database credentials remain on trusted servers.

Data Foundation provisioning creates four explicit roles:

| Role                 | Purpose and constraints                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `wiser_data_runtime` | Non-login common privilege group with only the required schema, table, sequence, and function privileges   |
| `wiser_data_api`     | API login that inherits runtime privileges; non-superuser and unable to bypass RLS                         |
| `wiser_data_worker`  | Worker login that inherits runtime privileges with a separate password and timeouts                        |
| `wiser_data_gis`     | Isolated GIS login that does not inherit the common runtime and can execute only the governed MVT function |

Every Data database transaction sets and validates transaction-local `wiser.tenant_id`, `wiser.project_id`, `wiser.max_security_level`, and `wiser.policy_version` values with `set_config`. Missing or mismatched context returns no rows or fails; it must never degrade into an unscoped query. All roles remain `NOSUPERUSER` and `NOBYPASSRLS`, and applications never connect as the migration owner at runtime.

## Transactions, concurrency, and Outbox

Authoritative changes that must hold together belong in one explicit PostgreSQL transaction: set authorization context, lock the row or check its version, write business state, append Event/Audit/Outbox facts, and commit. Any failure rolls the transaction back.

- Competitive claims use row locks, `FOR UPDATE SKIP LOCKED`, leases, or optimistic versions rather than process-local mutexes.
- Unique constraints, stable idempotency keys, and request hashes make retries safe.
- Events, audits, receipts, versions, and outboxes remain append-only. Corrections append new facts.
- A Data authority commit writes Version, quality/lineage facts, Operation event, Audit, and Outbox in one `data-postgres` transaction.
- Outbox consumers use monotonic checkpoints and per-target ledgers. A projection write can be retried after a crash before checkpoint advancement, while already successful targets are skipped.
- Work spanning Supabase, `data-postgres`, S3, and projection stores uses Outbox, idempotency, and compensation. It has no cross-system ACID guarantee.

## Stop and reset

Stopping services normally does not require deleting data:

```bash
pnpm data:down
pnpm stack:down
```

The following commands delete local state:

```bash
pnpm supabase:reset
WISER_DATA_RESET_CONFIRM=reset-wiser-data-foundation pnpm data:reset
```

`data:reset` continues only with the exact confirmation value and removes only resolved and validated WISER Data Foundation named volumes. That data is still unrecoverable. Confirm that no local uploads, versions, objects, or projections need to be retained. After a reset, use `pnpm stack:full:up` to rebuild, migrate, seed, and smoke the stack.

The repository does not currently provide a standard command that creates a temporary Data database while retaining existing named volumes. Prove “replay from empty” in CI or disposable local state with confirmation-gated `data:reset → stack:full:up`. If local data must be retained, stop rather than treating a destructive reset as an ordinary test step.
