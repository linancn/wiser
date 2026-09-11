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
lastReviewedAt: 2026-09-10
lastReviewedCommit: bac8703efbf93c408d68b6f7a8ca8305d9565c1b
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
   - `02_platform_auth.sql`: unified identity, tenants/projects, authorization, and delegation;
   - `03_agent_connections.sql`: private Agent connections, immutable OAuth credential bindings, token hook, and direct-session restrictions on exposed tables.

5. If local development identities or deterministic cases need new data, update `supabase/seed.sql`. Seeds must be repeatable, contain no real credentials, and agree with the pgTAP assertions.
6. Run the complete gate:

   ```bash
   pnpm supabase:verify
   ```

`supabase:verify` first executes `db reset --local`, then runs pgTAP, database lint, and all advisors. It deletes local Supabase data; never point it at a shared or production database. Never rename, reorder, or edit a migration that has entered history. Append another migration instead.

The Agent consent/exchange integration test uses `WISER_AGENT_TEST_DATABASE_URL` with a disposable, migrated and seeded Supabase database. Run `pnpm exec vitest run apps/api/test/platform-agent-connections.integration.spec.ts` with that variable set. It creates synthetic OAuth Sessions, clients, consents and Agent memberships; run it after pgTAP, not concurrently with seed-count assertions. Without the variable, the integration suite is skipped. Normal unit tests remain independent of databases and AI providers.

## Data Foundation change workflow

`0010_source_registration.sql` adds immutable source-registration JSON to `ingestion.session`, under its existing forced RLS. Source identity and declared limitations cannot change during state transitions; the descriptor is also frozen into the committed Version manifest. The focused `packages/data-infra/test/migrations/source-registration.spec.ts` test runs with `WISER_DATA_PG_INTEGRATION=1` and `DATA_TEST_DATABASE_URL` pointing to a disposable migrated database. It verifies a role without BYPASSRLS, cross-project invisibility, legal transitions and rejection of descriptor edits. Real research files remain outside seed data and Git.

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

| Role                 | Purpose and constraints                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `wiser_data_runtime` | Non-login common privilege group with only the required schema, table, sequence, and function privileges    |
| `wiser_data_api`     | API login that inherits runtime privileges; non-superuser and unable to bypass RLS                          |
| `wiser_data_worker`  | Worker login that inherits runtime privileges with a separate password and timeouts                         |
| `wiser_data_gis`     | Isolated GIS login that does not inherit the common runtime and can execute only the governed MVT functions |

Every Data database transaction sets and validates transaction-local `wiser.tenant_id`, `wiser.project_id`, `wiser.max_security_level`, and `wiser.policy_version` values with `set_config`. Missing or mismatched context returns no rows or fails; it must never degrade into an unscoped query. All roles remain `NOSUPERUSER` and `NOBYPASSRLS`, and applications never connect as the migration owner at runtime.

Table grants are not permission to bypass domain authority. Database triggers on `service.operation`, `ingestion.session`, `ingestion.job`, and `ingestion.transform_plan` validate every row update, not only statements that explicitly name the state column. They reject illegal lifecycle edges, identity or scope rebinding, policy mutation, security downgrade, terminal-result or frozen-plan mutation, invalid same-state lease/content changes, and any optimistic version change other than `old.row_version + 1`. Keep application/core transition policies and these database guards synchronized whenever a legal edge changes.

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

## Exploration manifests

`0011_exploration_queries.sql` adds the private `service.exploration_snapshot` cache with forced owner RLS, immutable manifests, a 30-minute maximum lifetime, bounded version references and owner/expiry indexes. Query transactions additionally set `wiser.actor_id` and `wiser.purpose`; policy version and security ceiling must match exactly. Runtime provisioning grants deletion only for this cache and removes update permission. It does not relax append-only history tables. Creation prunes expired and excess manifests visible to the same owner/context. Expired manifests belonging to inactive contexts can be removed by a privileged operator using the expiry index; expiry alone does not imply physical deletion.

Run `apps/api/test/data-exploration.integration.spec.ts` with `WISER_DATA_PG_INTEGRATION=1` and `DATA_TEST_DATABASE_URL` against a migrated database. Its synthetic rows and temporary non-bypass role are contained in a rolled-back transaction; it verifies stable pagination, new versus pinned versions, exact historical queries, empty results, actor/project/tenant/purpose/policy/security isolation and expiry.

Migration `0012_analysis.sql` adds scoped, version-bound analysis runs, per-asset outcomes and PostGIS-backed records in the independent Data Foundation database. Re-run the checksum migration runner; do not reset registered source data.

Migration `0013_analysis_query_scope.sql` keeps forced analytical-record RLS and the same tenant, project, security-level and policy predicates, while evaluating request-constant helpers once per statement. Record pages use the selected analysis/asset index order; totals still count authorized rows rather than trusting broader asset metadata. The real 361,379-row reservoir source is covered by a bounded-page browser performance test.

The internal query-tile source `service.wiser_exploration_mvt` (migration `0014_exploration_tiles.sql`) binds seven trusted parameters: tenant, project, actor, query, purpose, security ceiling and policy version. Its execute-only GIS role cannot read tables. The function reauthorizes every pinned member and rejects expired or unavailable queries before spatial selection. Each tile aggregates points into at most 4,096 cells; cluster counts cover only scoped records. Single features carry record/asset/analysis/version/item identities for exact lookup, while original values stay in record queries. Lines and polygons are clipped to the tile. The Web Mercator representation excludes polar regions outside its latitude domain, and tiles over 3 MiB fail rather than silently dropping features. A rolled-back PostgreSQL integration fixture decodes MVT and checks 100,000 point counts, bounded bytes, foreign scopes, expiry and missing membership.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Migration `0016_exploration_record_queries.sql` adds deterministic numeric parsing and shared record predicates, then replaces the query MVT function to apply the immutable source asset and predicates before clustering. Earlier migrations remain unchanged. Rolled-back integration checks typed conversion, ordering/pagination, projected fields, exact-row and graph lookup, and decoded filtered MVT counts.

Migration `0017_exploration_predicate_compilation.sql` preserves typed comparison semantics while exposing the maximum-eight-predicate expression tree to PostgreSQL planning. Numeric conversion uses guarded exact SQL/JSON numeric parsing. Record queries evaluate each distinct typed field once in a bounded source-asset scan, materialize only identities and comparison values, count and select the ordered page from that relation, and fetch original content only for page identities. Null placement and source-index tie-breaking remain stable. Integration compares 187 legacy/new scalar-predicate combinations before exercising RLS, pages and filtered MVT.

Migration `0020_exploration_saved_views.sql` creates forced-RLS saved configurations with owner/private or explicit project visibility. Content is immutable; the only allowed update is one-way `revoked_at`. Runtime provisioning restores column-only revocation privileges after general grants. The existing command transaction writes idempotency, audit and outbox records atomically. Saved rows are not identity or membership authority.

Migration `0021_amap_display.sql` keeps WGS84 analysis records append-only and builds a separate, indexed `service.analysis_amap_geometry` display projection. A guarded insert derives geometry once; migration backfill touches only the projection. Its RLS follows source scope, with no direct runtime or GIS table grants. Shared tile authorization selects the original or AMap display plane; lateral primary-key record lookups prevent a pathological join before fresh projection statistics are available. Nonlinear line/polygon conversion densifies display vertices; source coordinates are unchanged.

`0022_observation_reconciliation.sql` adds immutable candidate/review evidence with forced owner/scope RLS, one-way optimistic review, and narrow column grants. `pnpm test:postgres:data-api` includes `data-reconciliation.integration.spec.ts`; run it only against a disposable migrated database. It verifies source reauthorization, idempotency, pagination, review conflicts, and unchanged original records using a role without BYPASSRLS.

After its common table grants, runtime-role provisioning explicitly revokes whole-table updates on reconciliation evidence and restores updates only to `status`, `row_version`, `reviewed_at` and `review_note`. Repeated provisioning must preserve this boundary as well as forced RLS and the immutable-evidence trigger.

Migration `0023_exploration_point_guard.sql` adds a materialized point-only stage before tile clustering. The rolled-back exploration integration suite combines 100,000 points with a line and polygon, changes the type-check planner cost within a savepoint, and decodes both authority and Amap tiles. It verifies that permitted predicate reordering cannot invoke X/Y access on non-point geometry, while preserving record identities, point totals and existing authorization boundaries.
