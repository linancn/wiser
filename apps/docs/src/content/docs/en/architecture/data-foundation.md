---
title: Data Foundation domain architecture
description: Data Foundation authority, ingestion slice, projections, protocols, and verification contract.
docType: architecture
scope: data-foundation
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing Data Foundation DTOs, Capabilities, states, authority, or publication gates
  - when implementing or reviewing data-postgres, object storage, Worker, projections, API, MCP, Skill, or Web
whenToUpdate:
  - when public contracts, transitions, authorities, projections, or completion boundaries change
checkPaths:
  - packages/data-*/**
  - apps/data-worker/**
  - apps/api/src/data-foundation/**
  - apps/mcp/src/data-foundation/**
  - apps/web/src/app/*/data-foundation/**
  - infrastructure/data-foundation/**
lastReviewedAt: 2026-09-10
lastReviewedCommit: bac8703efbf93c408d68b6f7a8ca8305d9565c1b
---

## Authority boundary

Data Foundation is a WISER business system peer to Agent EXCON. It owns DataItems, immutable versions, assets, ingestion, quality, lineage, knowledge, search, GIS, Operations, and projection facts. It does not own user sessions, tenants, projects, memberships, roles, or tokens. Supabase Auth/PostgreSQL is the unified identity and control plane; independent data-postgres/PostGIS plus S3-compatible object storage form the Data authority.

The default Data runtime composes:

```text
Supabase principal + Tenant/Project/Purpose
  → Fastify REST / schema-first GraphQL
  → one DataCapabilityHandler (24 static executors)
  → data-postgres RLS transaction / SeaweedFS S3
  → PostgreSQL durable job + Transactional Outbox
  → Data Worker
  → PostGIS spatial readiness (inside the same data-postgres)
  → rebuildable external Weaviate / OpenSearch / Neo4j / STAC projections
  → REST / GraphQL / MCP / authenticated Web readback
```

GeoServer, TiTiler, and Martin run as Compose-internal GIS services in the same exactly pinned profile without host-published ports; external access traverses the unified-Auth Fastify GIS proxy. The Outbox ledger has five completion targets. `POSTGIS` establishes/verifies governed `catalog.spatial_extent` representations inside authoritative data-postgres; its source/version/spatial authority rows are not a disposable external projection. Weaviate, OpenSearch, Neo4j, and STAC are rebuildable external projections. No single target decides identity, authorization, acceptance, or publication.

## Packages and dependency direction

| Module                                      | Responsibility                                                                      |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@wiser/data-contracts`                     | Strict Zod DTOs, 33 Capabilities, four transport mappings                           |
| `@wiser/data-core`                          | Pure ingestion/Operation state, quality, security inheritance, publication gates    |
| `@wiser/data-infra`                         | Checksum migration, PostgreSQL/S3, jobs/Outbox, projections, search, fake embedding |
| `@wiser/data-worker`                        | Concrete ingestion Handler, Scheduler, projection consumer, health and metrics      |
| `apps/api`                                  | Unified-auth REST/GraphQL composition and safe download redirects                   |
| `apps/mcp` / `skills/wiser-data-foundation` | Agent adapters that use HTTP only                                                   |
| `apps/web`                                  | Bilingual read-only governance workspace driven by a server-only DAL                |

Dependency direction is `platform contracts <- data-contracts <- data-core <- application/infra <- apps`. Core imports no database, HTTP, filesystem, framework, clock, random source, or AI provider. Time, IDs, and effects enter through ports.

## One Capability contract

`@wiser/data-contracts` is the sole source for REST, GraphQL, MCP, Skills, and runtime validation. Public DTOs use strict Zod 4 schemas; unknown and missing fields both fail. `GET /api/data/v1/capabilities` returns draft-7 input/output JSON Schema, scopes, security ceiling, execution mode, timeout, audit level, and exact mappings for all four transports.

The Registry covers catalog/version, query/search, knowledge/graph, geo, upload/ingestion, and Operation lifecycles. Exact Capability IDs, order, versions, scopes, and transport mappings live only in the discovery endpoint and [protocol reference](/en/protocols/data-rest/); this architecture page does not maintain a second list.

Every executor traverses input/output validation, live scopes, the security-level ceiling, purpose, declared timeout, command idempotency, and hash-only audit. Queries accept structured filters only—never arbitrary SQL, Cypher, OpenSearch DSL, shell, or database administration.

The local `data-steward` Role seed grants only the scopes needed by the demonstration. A new Capability changes Registry, role/scope, API, MCP, Skill, docs, and verification together.

## Data model and independent migration history

Data SQL never enters the Supabase migration history. `infrastructure/data-foundation/postgres/migrations` is canonical:

| Migration                                    | Content                                                                                                                          |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `0001_bootstrap.sql`                         | pgcrypto, PostGIS, btree_gist, unaccent, eight business schemas, migration ledger                                                |
| `0002_authority_model.sql`                   | catalog, asset, ingestion, quality, lineage, knowledge, Operation, security, Outbox model                                        |
| `0003_security_jobs_events.sql`              | RLS, authorization session settings, append-only guards, job/event security                                                      |
| `0004_job_lifecycle.sql`                     | claim/heartbeat/settle/fail/recover/cancel and atomic Operation/Outbox transitions                                               |
| `0005_content_blob_model.sql`                | separate content and asset identity, backfill, immutable storage references                                                      |
| `0006_content_lifecycle_constraints.sql`     | structural `QUARANTINED → FINGERPRINTED → RAW` lifecycle                                                                         |
| `0007_version_publication_lifecycle.sql`     | the sole one-time `UNPUBLISHED → PUBLISHED` change with content fixed                                                            |
| `0008_governed_gis_tiles.sql`                | one Martin-discoverable governed MVT function with five fixed scope parameters                                                   |
| `0009_authority_state_transition_guards.sql` | legal Operation, Ingestion, Job, and Transform Plan transitions with immutable authority scope and exact row-version advancement |

The TS7 runner sorts four-digit versions, runs each file transactionally under one session advisory lock, and records filename plus SHA-256. Missing, renamed, modified, or non-prefix applied history fails closed. pgSTAC uses official pyPgSTAC 0.9.12 migrations rather than pretending to be a PostgreSQL extension.

There are 36 business tables, every one with `ENABLE` and `FORCE ROW LEVEL SECURITY`, plus a separate `schema_migrations` ledger. API and Worker use distinct non-superuser roles created by deployment provisioning; migrations do not grant runtime implicitly. Every transaction sets validated Tenant, Project, maximum security level, and policy version. Missing context returns no rows or fails.

Martin uses an isolated `wiser_data_gis` login: `NOSUPERUSER`, `NOBYPASSRLS`, no generic runtime-role inheritance, no business-table privileges, and execute-only access to the governed version and query MVT functions. The version function `service.wiser_spatial_extent_mvt` accepts exactly five `tenantId/projectId/versionId/maxSecurityLevel/policyVersion` query values and repeats Version/spatial-extent filtering inside SQL.

API vector tiles RLS-authorize the Version/spatial extent before injecting those five values into the function. Raster tiles select only a visible RAW TIFF/GeoTIFF COG, validate its `tenants/.../versions/{versionId}/sha256/{hash}` content-addressed key, and only then construct the internal S3 URI for TiTiler server-side. Browsers cannot select an object or upstream.

Triggers reject invalid UPDATE/DELETE on Operation, Audit, Outbox, content, and version history. Operation, Ingestion Session, Job, and Transform Plan updates are guarded at the database boundary: legal lifecycle edges, immutable identity/scope/policy facts, non-decreasing upload security, immutable frozen plans, and exactly one `row_version` increment are enforced even for a runtime role with table `UPDATE`. Terminal Operation content cannot be rewritten. The narrow same-state cases used for non-terminal Operation progress aggregation, a running Job heartbeat/cancellation request, and a fully identical Transform Plan replay remain legal. Multi-Job aggregation may move an Operation between the two waiting states; direct upload completion is capability-scoped in both Core and PostgreSQL. Complex transitions use explicit transactions, row locks or optimistic versions, unique constraints, and append-only facts.

## Authority objects and commit

`DataItem` is the smallest governance unit, not a file, table, or layer. Processing stage, quality grade, acceptance status, publication status, and L0–L3 security level remain separate dimensions.

The SeaweedFS adapter forces path-style S3 and derives every key from validated Tenant/Project/Upload/Version UUIDs and lowercase SHA-256; callers cannot supply arbitrary paths. Upload is an unambiguous `PRESIGNED_PUT` or `MULTIPART` contract. Signed URLs live for 60–900 seconds. Completion HEAD-checks size, content type, and SHA-256 metadata.

Content remains in quarantine first. Fingerprinting establishes `catalog.content_blob`; formal commit idempotently promotes it to content-addressed raw/version keys. An identical hash can be reused, while a different hash is never overwritten. Abort removes only a derived quarantine object. Version-asset reads reauthorize through Supabase and data-postgres RLS, append audit, then return a 60-second `303` signed redirect. STAC manifests never expose long-lived S3 credentials.

MCP Evidence/STAC Resources read through real HTTP authority boundaries. Evidence GET returns only an RLS-visible fragment attached to a committed version and appends `data.evidence.read` hash-only audit. STAC GET first binds collection to the current Tenant/Project, reads bounded data from one fixed internal STAC origin, strips upstream internals, then reconciles published/accepted version, Evidence, source hash, security, policy, and quality in data-postgres before appending `data.stac-item.read`. Both JSON responses are capped at 256 KiB, and a STAC asset can target only the short-lived governed download endpoint above.

Only an approved frozen review checkpoint can create a formal version. One data-postgres transaction commits DataItemVersion, quality/lineage facts, Operation event, Audit, and Outbox. Supabase, data-postgres, and S3 never pretend to share a distributed transaction.

## Deterministic ingestion and Agent boundary

Research bundles may select the optional `sourceRegistration` profile on ingestion. Migration `0010_source_registration.sql` stores its immutable descriptor on the RLS-protected ingestion Session. A bounded JSON manifest binds the declared source, original paths/hashes, sanitized derivatives, partial/sample/empty states, and every uploaded asset to exact size and SHA-256. It rejects missing, duplicate, unlisted or changed assets; zero-byte sources are explicitly recorded without fabricating a nonempty upload.

Distinct paths with identical prepared bytes may reference one content asset. Each path still has its own original/prepared size and hash, disposition, completeness and associations, and every alias must match that asset exactly. Duplicate paths and duplicate authority asset identities remain invalid. The Skill uploads each prepared content hash once per source registration and retains all path aliases in its manifest and bounded evidence excerpt.

This profile validates **source registration**. It preserves raw objects, uses deterministic manifest validation instead of document/GIS parsing or an AI mapping plan, and creates `METADATA_QUALITY` / `DECLARED` versions with source names, providers and limitations. Passing quality means the registration integrity checks passed; analytical validity, dataset completeness, licensing and geospatial correctness are not inferred. Scanning, fingerprinting, security inheritance, review, transaction/audit/Outbox and publication gates still apply. Frozen source limitations flow into evidence, graph and STAC search projections.

Ingestion has exactly 18 states:

```text
RECEIVED → QUARANTINED → SECURITY_SCANNED → FINGERPRINTED
→ PROFILED → CLASSIFIED → SCHEMA_MAPPED → SEMANTIC_MAPPED
→ VALIDATED → SPATIOTEMPORAL_ALIGNED
→ REVIEW_REQUIRED / APPROVED / REJECTED
→ COMMITTED → PROJECTING → PUBLISHED

Policy may move eligible non-terminal states to FAILED or CANCELLED;
REJECTED, PUBLISHED, FAILED, and CANCELLED are terminal.
```

The default Worker executes ingestion through the concrete `data.ingestion.process.v1` Handler:

1. restore uploads and version from authority;
2. verify size/media type through the S3 reader;
3. scan with ClamAV INSTREAM;
4. stream SHA-256 and persist fingerprints;
5. parse Markdown/documents with Tika and GeoJSON with a controlled parser that retains source CRS;
6. produce deterministic profile/classification;
7. let the fixture fake Agent propose schema/semantic plans, then validate confidence and shape through an injected validator;
8. run deterministic transformation, quality, and EPSG:4326/4490/3857 alignment;
9. freeze a hash-only review checkpoint and route low-confidence/high-risk work to human review;
10. commit authority and Outbox after approval, then publish only after all five completion-target ledgers succeed.

Tika 4 runs only on the private Data network. The Worker keeps the explicit `PUT /rmeta/text` JSON contract, while the mounted server configuration limits requests to 16 MiB, extracted output to one million characters, total parsing to 30 seconds, and the fork pool to one child. HTTP `429` and `503` remain retryable dependency failures; malformed `400` requests and over-limit `413` requests are terminal. This absorbs Tika 4's process isolation and backpressure semantics without exposing its raw error bodies.

An Agent proposes explanations and plans. It cannot modify source data, silently correct fields, decide quality/acceptance, bypass review, or write authority/projection stores. The fake Agent and `DeterministicFakeEmbedding` are for tests, CI, and local smoke only; identical text, version, and dimension yield identical finite vectors. Worker records Agent run/action, model identity, input/output hashes, and transform plan without putting prompts, credentials, or object bodies in audit.

Quality reads deterministic checks only; one failed blocking rule prevents passage regardless of score. Derived security inherits the highest source level and may only be raised. Publication requires a committed version, eligible acceptance, passing quality, `PROJECTING`, and five unique `SUCCEEDED` targets.

## Durable jobs, Outbox, and projections

Worker uses PostgreSQL `FOR UPDATE SKIP LOCKED`, lease owner/expiry, heartbeat, priority, attempt count, deterministic exponential backoff, cancellation, waiting-input/review, timeout recovery, and dead letter. The timestamped claim function records the selected row's actual previous status before mutation; the superseded claim function without Job Attempt/Event/Outbox semantics is removed from the database. Native Node HTTP exposes `/health/live`, `/health/ready`, and Prometheus `/metrics`. Graceful shutdown stops claiming and drains in-flight handlers.

`ProjectionOutboxConsumer` reads after a monotonic checkpoint. Per-target `PENDING/RUNNING/SUCCEEDED/FAILED` ledger survives crashes; an external write that completed before ledger update can be retried safely. The live Worker derives a separate checkpoint for each real embedding profile and configured consumer name. It writes Weaviate for every event after that checkpoint even if the shared ledger already succeeded for another collection, while skipping other successful targets. The legacy fake checkpoint remains available for fixture compatibility and rollback. First activation traverses retained history independently of the rebuild CLI; later starts resume. Cutover and rollback switch the Worker first and verify catch-up before changing API reads. Projection identity derives from authoritative DataItem/Version/Evidence IDs:

If all five completion targets succeeded but the matching Operation is already `FAILED` or `CANCELLED`, that publication poison event may neither rewrite the terminal Operation nor publish the authoritative version. Consumer writes `PUBLICATION_OPERATION_TERMINAL` to `consumer_checkpoint.last_error` and advances past the event so it cannot block the queue head; a later successful event clears the summary. Original Job, Operation, target ledger, and version evidence remain intact.

- data-postgres/PostGIS `catalog.spatial_extent` retains RLS-protected source geometry, CGCS2000 canonical geometry, and a Web Mercator display derivative; authority rows are not cleared with projection caches;
- Weaviate uses Worker-provided versioned vectors and an authenticated tenant;
- OpenSearch uses a governed ICU index;
- Neo4j uses fixed parameterized `MERGE` facts;
- pgSTAC writes STAC 1.1 Collections/Items whose asset href reaches the governed API download endpoint.

### Chinese and mixed-language retrieval contract

Content is primarily Chinese with optional English and code-switching, but the three search projections do not duplicate the same signal:

- **OpenSearch is the primary lexical retriever for document content.** `wiser-evidence-v2` indexes the same `content` through three governed fields: the ICU primary field applies `nfkc_cf` Unicode compatibility normalization before `icu_tokenizer` and `icu_folding`; the official SmartCN field adds Simplified-Chinese dictionary/HMM boundaries; a low-weight CJK field uses overlapping bigrams to recover segmentation ambiguities. The fixed query combines ICU `3`, SmartCN `2`, CJK `0.75`, and an ICU phrase boost of `4`, requiring at least one route. These weights are a governed baseline until a judgment set supports Recall/NDCG tuning. Generic n-grams, unofficial IK plugins, and unreviewed synonym files stay out of the default production path. See the [OpenSearch ICU analyzer](https://docs.opensearch.org/latest/analyzers/language-analyzers/icu/), [CJK analyzer](https://docs.opensearch.org/latest/analyzers/language-analyzers/cjk/), and [official plugin catalog](https://docs.opensearch.org/latest/install-and-configure/additional-plugins/).
- **Weaviate is the pure-vector semantic retriever.** `WiserEvidenceChunkV2` keeps Worker-supplied versioned vectors, while the `semantic` channel now uses `nearVector` instead of running another internal BM25 leg. OpenSearch lexical evidence therefore cannot vote twice in outer RRF. Content is stored without an inverted index; Tenant/Project/Version, security, publication, and channel metadata use `field` tokenization and indexes only where filtering requires them. Query and object vectors must exactly match the configured dimensions. Tenants are provisioned by the controlled writer and `autoTenantCreation` is disabled. See [Weaviate bring-your-own vectors](https://docs.weaviate.io/weaviate/concepts/search/vector-search#bring-your-own-vector) and [multi-tenancy](https://docs.weaviate.io/weaviate/manage-collections/multi-tenancy).
- **Neo4j supplies graph seeds.** Before graph writes, the Worker idempotently creates and waits for `wiser_entity_name_cjk_v1` to become ONLINE. The index uses Neo4j's official `cjk` analyzer on `WiserEntity.name`, updates synchronously, orders by Lucene score, and follows `EVIDENCED_BY` back to Evidence. User text is NFKC-normalized, capped at 64 literal terms, and Lucene-special characters are escaped by the server. Tenant, Project, security, policy, acceptance, and publication facts are rechecked across entity, relation, and evidence. The built-in analyzer produces CJK bigrams; it does not perform simplified/traditional conversion, pinyin, or domain-dictionary expansion, and cannot reliably retrieve a single Han character from a longer run. Neo4j therefore never replaces OpenSearch document search. See [Neo4j full-text indexes](https://neo4j.com/docs/cypher-manual/current/indexes/semantic-indexes/full-text-indexes/).

Each backend produces an independent ranking before `SearchOrchestrator` applies fixed `RRF k=60`; OpenSearch BM25, Weaviate distance, and Neo4j Lucene scores are never added directly. An OpenSearch analyzer, Weaviate schema, or Neo4j analyzer change creates a new versioned physical index/collection, replays projections from data-postgres authority, and passes Chinese, English, and mixed-language golden queries before read cutover. An `IF NOT EXISTS` result or one schema `200` must never hide old index semantics. Tests, CI, and local smoke still use deterministic fake embeddings; production semantic recall separately selects and pins one Chinese/English-evaluated embedding model, version, and exact dimension.

Matching query adapters push down Tenant, Project, Version, security, policy version, acceptance, publication, domain, and channel filters. `SearchOrchestrator` recalls in parallel, applies fixed `RRF k=60`, deduplicates by DataItem+Version, then reauthorizes every hit and redacts excerpts.

## Protocol and product surfaces

The graph workspace lazily loads G6 5.1.1 on the client and renders only the bounded, governed HTTP result. A keyboard-accessible entity list and selection inspector retain exact Version/Evidence provenance when the canvas is unavailable. Canvas resources are released after pending rendering completes; theme changes reuse semantic tokens. The initial layout is deterministic and does not imply spatial relationships.

The Data overview reads the scoped catalog total with `includeTotal=true`; its metric is independent of the preview page size. Catalog count and page use one short repeatable-read authority transaction. Counts describe registered objects, not analytically validated records.

- REST: `/api/data/v1` discovery, 33 Capabilities, Operation SSE, Evidence/STAC Resources, authorized asset redirects, and the sole external OGC/STAC/vector/raster GIS proxy. Fastify OpenAPI projects all 33 Capabilities directly from the Zod 4 Registry and documents GIS GETs with explicit safe route Schemas under the shared **WISER Platform API** title; see [Data REST](/en/protocols/data-rest/).
- GraphQL: `POST /graphql`, 24 schema-first fields sharing the same Handler; see [Data GraphQL](/en/protocols/data-graphql/).
- MCP: stdio/stateless Streamable HTTP, 33 Tools and governed Resources that call HTTP only; see [Data MCP](/en/protocols/data-mcp/).
- Skill: `skills/wiser-data-foundation` documents discovery, query, upload, ingestion, Operation, and security workflows.
- Web: 14 Data routes in the existing Next.js app with server-only DAL, real Supabase session, both locales/themes, immutable-version selection, an official AMap JS API 2.0 basemap with synchronized transparent MapLibre overlays: PostGIS authority GeoJSON, STAC extents, governed vector MVT, and raster.

DataItem detail `?version=<uuid>` sends the requested version to API and verifies `selectedVersion`; version links use `aria-current` and can open the governed map. Map query is `?bbox=minx,miny,maxx,maxy&dataItem=<uuid>&version=<uuid>&crs=EPSG:4326|EPSG:4490`, with independent layer controls plus pinned Version and the AMap display alignment. For `data.geo.query`, omitting the singular `versionId` selects extents from the latest visible committed version of each DataItem, while supplying it selects extents from that exact immutable version; each response remains bounded by `first` and continues through a snapshot/query/scope-bound opaque `nextCursor`. `dataItemIds`, when present, intersects either selection, and a hidden or absent exact version yields an empty result set. `data.geo.intersect` applies the same snapshot cursor, selects DataItem target versions before extents, unions every sibling extent of the selected version, and returns empty when either target is absent, hidden, or has no extent instead of falling back to history. The Map server forwards the selected `versionId` into the authoritative PostGIS query before version ranking, drains governed pages up to 10,000 features, and fails closed on repeated cursors or overflow; it never filters a latest-version result afterward. The browser calls only same-origin `/api/data-foundation/geo/...`; Next server uses the freshly verified short-lived Supabase Session and adds Tenant/Project/Purpose before forwarding to Fastify. Bearers and internal GIS origins never reach the client.

Every current `DataItemVersion` carries required `tileAvailability: { vector, raster }` authority metadata. `vector=true` means that visible committed Version has a visible version-level spatial extent. `raster=true` means that it has a visible RAW TIFF/GeoTIFF asset with verified blob/hash/input linkage and the exact content-addressed storage key. These flags mean a governed tile source is routable; they do not claim Martin/TiTiler health or prove COG conformance. Catalog links carry both DataItem and Version, and Map re-reads that exact authoritative pair before emitting either tile URL.

Web governs and queries; it never performs file parsing, vectorization, GIS transformation, or projection in a Server Action or Route Handler. Its same-origin GIS Route Handler is only a bounded authenticated proxy. Mutations enter through REST, GraphQL, MCP, or the Skill.

## Dependencies and executable verification

Exact npm versions come from the relevant `package.json` files and the root `pnpm-lock.yaml`. Stable Data container tags, digests, and compatibility notes come from `compose.yaml` and `infrastructure/data-foundation/versions.env`. Architecture prose does not duplicate those frequently changing inventories.

`pnpm data:smoke` validates upload, scanning, parsing, controlled Agent planning, deterministic transformation, quality/human gates, authority commit, Outbox, and all projections, then reads the result through REST, GraphQL, MCP, and authenticated Web. Reprocessing the same Outbox event must create no duplicate authority or projection object. See [Testing and verification](/en/development/testing/) for the command matrix and [Databases and migrations](/en/development/databases/) for reset and migration discipline.

## Versioned exploration

`data.explore.query` creates a 30-minute result set from caller-visible published versions. Its declarative `QuerySpec` supports text, item IDs, explicit version pairs, business domains and quality grades. Without explicit version pairs, it selects the latest authorized published version per item. A server-side manifest pins up to 10,000 version references; resource pages contain at most 200 entries. Broader searches must be narrowed.

Every continuation binds the result set to Actor, Tenant, Project, Purpose, exact authorization version and security ceiling. PostgreSQL forced RLS protects the manifest; each view also checks its published item/version references against current authority. Permission or publication changes invalidate continuation instead of silently changing the result set. New publications do not replace pinned versions. This fixes version membership, not a distributed snapshot of all projections. Readiness and analytical counts remain separate: registration-only resources report `NOT_PARSED` and unknown counts as `null`.

The Web exploration workspace at `/en/data-foundation/explore` shares these contracts and the current Supabase session through its Next.js API adapter. It provides a compact resource table, query controls, stable pagination and exact-version selection details.

The analytical parser in `@wiser/data-infra` verifies source SHA-256 and streams strict CSV records with stable, version-scoped identifiers. It preserves source strings, leading zeros, Unicode headers and nulls; column keys are independent of their display labels. JSON/GeoJSON parsing retains properties and validates declared WGS84 geometry; arbitrary longitude/latitude properties do not establish CRS or geometry. Malformed content, unsupported CRS and explicit size/record limits produce typed failures. Parsing does not change quality, acceptance, publication, source completeness or units. The opt-in `WISER_DATA_REAL_CASE=1` parser test verifies the admitted NLDI sample hash and coordinates without committing source content.

Analysis contracts bind requests to an existing data item and version. They distinguish successfully parsed empty sources (known zero counts) from unsupported, invalid or restricted sources (unknown counts and a reason code); partial parsing must disclose its reason.

`data.analysis.create` accepts an existing published `dataItemId` / `versionId` and an idempotency key. It creates an audited operation and a durable analysis job atomically; source registration and its quality declaration remain unchanged. REST: `POST /api/data/v1/analyses`; GraphQL: `createDataAnalysis(input: JSON!)`; MCP: `data_analysis_create`. Required scopes are `data.ingestion.write` and `data.catalog.read`. Poll the returned operation for completion.

Exploration 1.1 pins the completed analysis batch together with each published version. `view: "records"` requires `queryId` and `versionId` and returns per-asset columns, stable record/feature IDs and a bounded page. `view: "map"` reuses the same result set with an optional WGS84 `[west,south,east,north]` bounding box. Cursors are bound to their view and filters. Re-run the specification to include an analysis completed after the original query. Counts describe indexed records, while resource readiness and coverage disclose unparsed sources.

Exploration 1.2 adds `view: "graph"` on the same authorized manifest. Optional `versionId` narrows the resource graph; `recordId` additionally requires that version and a record in its pinned analysis. Typed resource/version/asset/evidence nodes express authoritative containment, with a focused record sharing its table/map identity. Asset nodes retain source hashes. This provenance view does not infer scientific relationships. Pages include at most 100 versions, 200 assets and 100 evidence fragments; `truncated` discloses omitted nodes and `nextCursor` pages remaining versions. Graph cursors cannot be reused across focus changes. Earlier 1.0 and 1.1 schema definitions remain archived.

The bounded CSV/JSON analyzer accepts up to 2,000,000 records per 64 MiB source. The real Beijing river CSV contains 1,048,575 rows and is validated without collecting all parsed records in memory. Capacity limits and unknown CRS are reported as unsupported analysis with a specific reason, not invalid source content; no partial count is published after an asset rollback.

Migration `0013_analysis_query_scope.sql` keeps forced analytical-record RLS and the same tenant, project, security-level and policy predicates, while evaluating request-constant helpers once per statement. Record pages use the selected analysis/asset index order; totals still count authorized rows rather than trusting broader asset metadata. The real 361,379-row reservoir source is covered by a bounded-page browser performance test.

The source-parser component in `infrastructure/data-foundation/parser` uses pinned openpyxl 3.1.5 read-only workbooks, xlrd 2.0.2 for legacy XLS and pypdf 6.18.0. It preserves sheet/row locations, formula text and date semantics, extracts inert document text, and checks archive paths, encryption, expansion budgets and member hashes. Archives retain member paths, hashes, parsed content and individual completion summaries; unsupported or failed members make the archive explicitly partial. Python dependencies are locked with hashes.

The parser image pins GDAL 3.13.3 and a hash-locked Python environment. Its private `/parse` protocol accepts only named bytes and SHA-256 values, validates the primary and companion files before writing a temporary directory, and streams bounded NDJSON. Each request runs in a disposable process with CPU, memory, duration and output limits; it has no database or identity authority. Client disconnects terminate parsing.

The worker parser adapter verifies admitted source bytes before transport, validates UTF-8 NDJSON schemas, row order and exact completion totals, and binds stable identifiers locally to the source version. Incomplete streams roll back; partial results retain an explicit reason.

Analysis jobs route XLSX/XLS, HTML/Markdown/text, PDF and ZIP assets through the isolated parser. The worker persists rows in bounded batches under its existing asset savepoint and lease fence. Capacity failures discard tentative rows and keep unknown counts; encrypted content is restricted. Partial summaries retain their reason at asset level and make the completed run partial.

Parser NDJSON uses HTTP/1.1 chunk framing with an explicit terminal chunk. This avoids relying on connection closure to signal completion to the Node worker; the application summary and counts remain independently mandatory.

The GDAL component reads Shapefile attributes with required SHX/DBF companions, retains original geometries and CRS, and disables ballpark coordinate transformations. Unresolved CRS never yields map geometry. Raster analysis verifies all source pixels in bounded strips, preserves bands, nodata, masks, units, scale and affine metadata, and discloses when cell values are not indexed. NetCDF retains variable dimensions, units, calendar attributes, masks and bounded values, including string coordinates with leading zeroes. Truncated content is invalid rather than a successful empty dataset.

The worker resolves geospatial companions only from the same admitted version and directory. Shapefile groups exclude unrelated scripts and neighboring directories; ArcInfo coverages are analyzed through their header once. Physical companions remain accounted for with `FORMAT_COMPANION` and zero independent records, rather than duplicating the coverage for every ADF member. Every transported member is hash-verified.

Parser frames accept at most 4 MiB while the complete stream remains limited to 1 GiB. This preserves the real case’s six polygons above 1 MiB (largest approximately 2.3 MB), without removing their coordinates. The three admitted Shapefiles in the main RESDC shape group reconcile to 8,628 records and zero verified WGS84 features; their CRS reasons remain explicit. Private-case browser checks require `WISER_DATA_REAL_CASE=1` and run separately from CI’s disposable fixtures.

Word extraction detects OOXML content even behind a `.doc` suffix, reads inert body/table/header/footer text with external XML entities disabled, and uses Ubuntu antiword 0.37-17 for binary Word text. Archive scripts and unsupported formats are inventoried without execution; member errors preserve already extracted content and an explicit member outcome. Nested ZIP expansion is unsupported. Record totals include content records and member summaries, not unique scientific observations.

Exploration retries a complete database transaction at most three times for serialization conflicts or deadlocks, while preserving caller scope and reauthorization. Other failures are not automatically retried. Record views initially select an asset with indexed content before a zero-record format companion; an explicit asset selection remains authoritative.

Exploration 1.3 adds exact provider names, registration kinds, and content/spatial readiness filters to `QuerySpec`. The result summary counts the entire authorized pinned set, separately from the current resource page. Completed analysis with no content assets is `METADATA_ONLY`; parsed empty content is `EMPTY`; parsed content without verified geometry is `NO_SPATIAL_DATA`, while unknown or untransformable source coordinates are `CRS_UNVERIFIED`. Invalid, restricted and unsupported unparsed content retains unknown counts. Physical format companions do not establish analytical availability. Indexed content records include source representations and document/archive records, not deduplicated scientific observations. The 1.0–1.2 schemas remain immutable in the contract archive.

Truncated PDF streams and invalid PDF page structures are classified as `INVALID_CONTENT`, preserving unknown counts and source completeness. They are not reported as parser service failures.

Exploration 1.4 permits `recordId` in `view: "records"`, together with `queryId` and `versionId`, to retrieve one exact record from the pinned analysis. The API resolves its source asset; an explicitly different asset or a record outside the query returns not found. Exact-record lookups cannot use continuation cursors. Existing resource, record-page, map and graph semantics remain version-scoped, and the 1.3 schemas remain archived.

The internal query-tile source `service.wiser_exploration_mvt` (migration `0014_exploration_tiles.sql`) binds seven trusted parameters: tenant, project, actor, query, purpose, security ceiling and policy version. Its execute-only GIS role cannot read tables. The function reauthorizes every pinned member and rejects expired or unavailable queries before spatial selection. Each tile aggregates points into at most 4,096 cells; cluster counts cover only scoped records. Single features carry record/asset/analysis/version/item identities for exact lookup, while original values stay in record queries. Lines and polygons are clipped to the tile. The Web Mercator representation excludes polar regions outside its latitude domain, and tiles over 3 MiB fail rather than silently dropping features. A rolled-back PostgreSQL integration fixture decodes MVT and checks 100,000 point counts, bounded bytes, foreign scopes, expiry and missing membership.

The query-result vector endpoint `GET/HEAD /api/data/v1/geo/tiles/vector/queries/{queryId}/{z}/{x}/{y}.pbf` additionally requires `data.query.execute` and `data.catalog.read`. Each request reauthorizes the owner-bound manifest and all pinned versions/analyses under RLS before calling Martin. Caller query parameters are forbidden; all seven scope values come from the verified context and path. Responses use the `exploration` source layer and `Cache-Control: no-store`; expired, revoked or foreign result sets cannot reach the upstream. Existing version-based tiles retain their route and layer.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

An authorized Martin `204 No Content` response is normalized to an empty `200` MVT response so empty viewports remain usable. This applies only after authorization and only to Martin; other missing content types still fail validation.

Exploration clears the current query, selection, asset details and rendered views when a response invalidates its authorization or immutable membership, or when the advertised result deadline is reached. Background/page restoration checks the same deadline. Late failures from an older query cannot clear a newer result, and aborted requests cannot restore stale data. Query form conditions remain available for a fresh authorized query. Temporary map failures unload the canvas and offer reload without exposing upstream diagnostics.

Hierarchical G6 5.1.1 canvases compute Dagre positions with the pinned @antv/layout 2.0.0 in an explicit same-origin module Worker bundled by Next.js. Only bounded node/edge identities enter the layout worker. The client validates finite, complete positions and terminates the worker on success, error, cancellation or the 10-second deadline; it does not silently move failed layout work to the main thread. Rendering starts after layout, and selection updates retain the existing canvas. The engine boundary accepts at most 5,000 nodes and 10,000 edges for bounded stress checks; HTTP graph responses retain their stricter contract limits.

Exploration 1.6 adds optional `spec.recordQuery` bound to exactly one explicit immutable `versions` entry and a source `assetId`. Up to eight typed text/number/presence predicates, one ascending/descending field sort and up to 32 unique selected columns are checked against the pinned analysis asset schema before creating the query. Numeric conversion accepts finite decimal/scientific values without rewriting source identifiers or original JSON. Null/missing values require explicit presence predicates. Record pages, map summaries, query MVT and focused graph records use the same predicates; exact lookup cannot bypass them. Sorting uses source record index as a stable tie-breaker. Column projection affects returned record values; catalog readiness totals still describe indexed source content. No cross-asset unit conversion or scientific aggregation is implied. Migration `0016_exploration_record_queries.sql` supplies shared predicates and updates the tile function; 1.5 remains immutable in discovery.

Migration `0017_exploration_predicate_compilation.sql` preserves typed comparison semantics while exposing the maximum-eight-predicate expression tree to PostgreSQL planning. Numeric conversion uses guarded exact SQL/JSON numeric parsing. Record queries evaluate each distinct typed field once in a bounded source-asset scan, materialize only identities and comparison values, count and select the ordered page from that relation, and fetch original content only for page identities. Null placement and source-index tie-breaking remain stable. Integration compares 187 legacy/new scalar-predicate combinations before exercising RLS, pages and filtered MVT.

Exploration 1.7 adds `view: "aggregate"` with an existing `queryId`, `versionId` and `aggregate` source specification. Text groups or positive-width numeric bins combine with count/sum/mean/min/max. Every grouping, value and optional unit field is checked against the pinned source schema; units are partitioned without conversion. The existing record predicates and authorization apply before grouping. Counts reconcile valid, missing and invalid measure values; count includes every matching record. Decimal results remain strings, numeric bins carry an exact upper bound, and the response contains at most 200 groups with full group/record counts and explicit truncation. Null group/unit labels include missing, non-scalar or over-4096-character labels; invalid numeric group values also enter the null bucket. Unknown units remain unspecified. The Web statistics tab supplies the fields form, a chart and exact-value table; selecting a representable group creates shared record conditions. Numeric charts approximate finite decimal values while the table retains exact source arithmetic. The 1.6 discovery schemas remain immutable.

Record pages treat `first` as a maximum and also enforce a conservative 3 MiB response budget. PostgreSQL measures the ordered candidate prefix before returning original content; selected columns are projected before measuring. The cursor advances by the records actually returned, so byte-limited pages neither skip nor duplicate records. Metadata/specification overhead is reserved, and a single record that cannot fit fails explicitly instead of truncating its fields. Record views return geometry presence for identity; complete map geometry remains in the map representation.

Exploration 1.8 adds typed time predicates and sorting, and hour/day/month/year aggregation. Source formats are `iso-offset`, `dmy-local` or `ymd-local`; `utcOffsetMinutes` is an explicit fixed offset from −840 to 840, not an inferred time zone or daylight-saving rule. ISO source values retain their own offset. Naive source times require the configured offset, which also defines calendar buckets. Invalid dates become ungroupable rather than normalized. Boundaries are UTC strings with up to six fractional digits, and ranges use inclusive `gte` plus exclusive `lt`. Source strings remain unchanged. The browser supports calendar lines, complete-bucket brushing and equivalent keyboard range controls; unit series remain separate. All views and MVT use the same conditions. The 1.7 discovery schemas remain immutable.

Exploration 1.9 accepts `baseQueryId` alongside a new `spec`. It reauthorizes the entire owner-scoped base before creating a fresh query, limits matching to its pinned version members and preserves each completed analysis ID (including an unparsed null). Explicit versions cannot expand beyond the base. Expired, inaccessible or revoked bases fail rather than silently refreshing to newer analyses. Web record controls and chart selections use this refinement path; ordinary new searches continue to resolve current authorized versions. The 1.8 discovery schema remains immutable.

Exploration 1.10 adds immutable `spec.spatialBounds` in WGS84 west/south/east/north order. It uses verified geometry intersections across records, aggregates, graph record lookups and query MVT before clustering. Resource and provenance overviews contain matching versions; source-readiness metrics retain their documented indexed-content meaning. The manifest keeps the underlying authorized pins so clearing or changing the area via `baseQueryId` does not refresh analyses or lose the original population. Every pinned member is reauthorized even when outside the current area. The map offers point/line/polygon visibility, a legend, local-font cluster counts and viewport filtering; layer visibility is presentation only and never changes query authorization or counts. Unverified coordinates are excluded explicitly. The 1.9 discovery schemas remain immutable.

Exploration 1.11 adds `graph.detail` (`assets`, `evidence`, `records`) for version-bound neighbor pages; record expansion also requires a source asset. `graph.grain` identifies the unit of `totalCount`. Continuation binds focus, detail and relation filters; records retain shared predicates, pinned analyses and the byte budget. `graph.relations` selects containment/provenance edge types. Optional `graph.path` finds a directed shortest path of at most eight edges within this returned page only, after relation filtering; missing endpoints fail without disclosing outside nodes. No path means no path in this page, not in the complete knowledge base. The 1.10 schemas remain immutable.

Saved exploration views use `data.explore.view.create`, `.list`, `.open` and `.revoke`; `data.explore.export` exports one bounded query representation. They require `data.query.execute` and `data.catalog.read`. Create/revoke are synchronous commands with UUID `Idempotency-Key`, atomic audit and command ledger. A saved view keeps the original QuerySpec, version/analysis pins and typed ViewSpec (view requests, page history, selection IDs, map camera/layers), not copied record content. At most 100 active views are kept per owner and project. Private is the default; explicit project sharing still requires authenticated project scope, purpose/security checks and authorization of every pinned member when opening. Listing returns only the caller's saved configurations. Opening reissues an owner-bound 30-minute query and continuation bindings without resolving newer versions or analyses; expiry of the original query does not expire the saved configuration. Revocation is one-way and owner-only. Export reauthorizes the request and returns original values, provenance and explicit returned/total counts with a coverage unit; a later page or truncated representation is never marked complete. No transport drains all pages into SSR/BFF memory.

The exploration workspace saves a named private view by default, with explicit project sharing, an opaque durable link and owner revocation. Saved links restore the authorized pinned query, record/graph pagination, selected source, map layers/camera and applied aggregation. Opening a saved link always creates a newly authorized query. Export downloads one bounded JSON page with original source values, exact returned/total counts and a complete/partial label; the initial map record page does not represent all loaded tiles. Draft conditions that have not been applied are not saved.

The Data workspace navigation groups search, knowledge and specialist GIS/graph tools under the exploration workspace while preserving their existing deep links. Exploration offers these specialist routes in its toolbar. Resource tables alone may hide the provider column on narrow screens; record and aggregate tables retain every selected field and unit in an internal scroll area. Source statistics keep whole-resource readiness in a separate disclosure that mounts its chart only when open. Source-hierarchy graph layouts use vertical worker layouts below 560 px of canvas width and expose keyboard-operated zoom, fit and selected-node focus controls. Viewport changes use no animation.

On screens up to 900 px, a selected source can be inspected in a non-modal bottom drawer. Opening moves keyboard focus into its labeled region; collapse or Escape returns focus to the toggle without clearing selection. Clearing the selection returns focus to the active view tab when needed. Desktop inspection remains inline and scrollable. G6 internal canvas layers are removed from the tab order; named viewport controls and the source node list provide the keyboard interaction.

The Portal derives its primary action from a verified session: authenticated users enter the Data workspace; anonymous users sign in. Catalog browsing uses 25-row cursor pages and a keyboard-focusable, internally scrolling table, preserving the name query on continuation and return to the first page. Source, publication, quality and security remain visible; the details explain check scope and content readiness.

The API and Worker share `DATA_EMBEDDING_PROVIDER` and one explicit embedding profile. Local smoke and CI default to `DeterministicFakeEmbedding`; production rejects fake mode. The OpenAI-compatible adapter supports the configured Qwen3-Embedding-8B service with 4,096 dimensions, distinct query instructions, bounded batches and responses, model/dimension validation, and L2 normalization. It never substitutes fake vectors on a service failure. Model, deployment revision, dimensions and query instruction derive a separate Weaviate collection; the revision identifies the deployed embedding profile and does not assert an unverified model-weight commit. Operators must bump it when server weights or preprocessing change. A scoped, restartable Worker rebuild reads authority evidence into that collection before query cutover, preserving the prior collection and publication ledger. See [Local environment](/en/development/local-environment/) for configuration and cutover.

Search evidence can still contain source-registration manifests; the Web labels their check scope and separates original excerpts from the result summary without changing authority facts. Intelligent analysis still requires content-specific indexing, domain/field semantics, relevance evaluation and governed plan execution. Neo4j provides relationship discovery and projections, while HTTP authorization and PostgreSQL/PostGIS remain authoritative. The Web links exact versions into resource, record, map, graph and statistics views and does not claim to generate analytical answers.

Knowledge graph canvases default to a ForceAtlas2 relationship layout with deterministic initial positions and 160 bounded iterations, computed in the existing cancellable worker. A keyboard-operable layout switch offers Dagre source hierarchy; only hierarchy changes direction on narrow screens. Both layouts retain bounded identities, selection, path highlighting and text alternatives. Independent resource neighborhoods are packed separately across both axes. The initial overview pages eight resources at a time; focused neighbor pages retain their own bounds. Relationship labels and semantic node colors supplement the node-kind text.

Exact source bytes are available through `GET/HEAD /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/{assetId}/content`. The API repeats the existing asset/version authorization and audit, signs only the internal storage endpoint, and streams with a two-minute deadline and single-range support. It does not expose a signed URL. The session-verified Web endpoint `/api/data-foundation/assets/{versionId}/{assetId}` provides an explicitly named attachment or an allowlisted inert preview; it strips upstream cookies and uses no-store, nosniff and a sandbox content policy. File downloads are independent of bounded query-page exports. Resource pages open parsed content before governance metadata, preserve exact version/file identities, and offer paged tables, source documents, structured values and linked map/graph views. Nested structures mount lazily in bounded groups and source labels remain available alongside display labels.

Maps use GCJ-02 only at the display boundary. Original WGS84/CGCS2000 coordinates, spatial predicates, and saved cameras retain their authority CRS. AMap zoom is MapLibre zoom plus one; bearing and pitch stay zero. GeoJSON and scoped vector tiles use calibrated display coordinates. The native AMap logo and attribution remain visible and interactive. The official JS key is public; the security code stays in the authenticated server proxy.

The SDK security proxy uses AMap's required first-level `/_AMapService` path. Next.js exposes it through `%5FAMapService`, while the authenticated configuration remains at `/api/maps/amap/config`. Both routes reuse the same verified-session and upstream allowlist checks; the security code is never returned to the browser. On the specialist map, a validated requested bbox locates a raster-only result when neither authority features nor STAC extents exist. That camera fallback does not create an asset extent or establish raster alignment.

Raster overlays inverse-map GCJ-02 pixel centers to authorized WGS84 TiTiler tiles in a dedicated browser Worker. Nearest-neighbor sampling preserves classes and nodata. The display grid uses eight-pixel interpolation inside China at zoom 8 and above, and exact mapping at coarse zooms or the coordinate-conversion boundary. Adjacent source requests are bounded; map disposal cancels requests and terminates the Worker. Raster values and originals remain unchanged.

## Copy verification and business observation deduplication

`data.reconciliation.create/get/list/review` maintains separate, durable reconciliation evidence. A batch pins two distinct CSV/XLSX/XLS assets, their immutable DataItem versions, completed analysis IDs, source SHA-256 hashes and paths. Both assets must be fully parsed (`READY` or `EMPTY`); document fragments, unsupported or truncated sources cannot establish observations. The browser starts the workflow from resource content for two files in the current version; the API also accepts explicit authorized pins across versions.

The caller defines up to eight paired business keys (text, exact decimal, or an explicit-offset ISO timestamp), observation value fields, measure and unit fields or constants, and optional decimal affine unit conversions. Text retains leading zeros; whitespace trimming is explicit. Different measures and unconverted units remain separate. Missing, blank or invalid values/keys remain incomplete; zero is valid. Unsafe numeric integer keys are incomplete rather than rounded. Only the selected fields define equivalence: matching filenames, byte sizes or row totals do not prove a copy, and a result does not establish equivalence of unused columns or source completeness beyond the parsed assets.

The pure deterministic engine groups by normalized business keys, measure and unit. It preserves every source record ID, side and row index, normalized value and group status. Equal observations collapse into one group; added and baseline-only observations remain. Different values remain conflicts unless the frozen plan explicitly declares that the comparison source revises the baseline. This precedence cannot resolve conflicting values within either individual source. Original files, parsed records, versions and source values are never changed or deleted.

Batches distinguish candidate format copies, overlap, revisions, disjoint observations and unresolved relationships. Four parsed rows representing two observations remain four parsed rows and yield two candidate observations. Any conflict or incomplete record makes the candidate total unknown. Only the creating human, with `data.publish`, can verify or reject a candidate using its expected version and a review note; only verification exposes `independentObservationCount`. Confirmation is scoped to this batch and its rules, never to an entire resource or catalog. Reviewed batches are immutable; different rules require a new batch.

Creation is synchronous and fails without truncation above 50,000 combined parsed rows, 8 MiB of selected fields per source, or 24 MiB of serialized group evidence. Group and source-member pages are separate, at most 100 items, with batch/version/group-bound cursors. Listing returns at most 100 recent batches involving the requested version. Commands use the shared transaction, audit, Outbox and idempotency ledger; replay reauthorizes the pinned sources. The private, forced-RLS `service.observation_reconciliation` table is bound to owner, tenant, project, purpose and security context. Every read/review rechecks current authorization for both versions and analyses, including after policy changes. Migration `0022_observation_reconciliation.sql` and the disposable PostgreSQL integration test enforce this boundary.

Migration `0023_exploration_point_guard.sql` materializes valid nonempty point candidates before clustering reads X/Y coordinates. This prevents legal predicate reordering from evaluating point-only functions on line or polygon records; both authority and Amap query tiles retain their existing scope checks and source geometries.
