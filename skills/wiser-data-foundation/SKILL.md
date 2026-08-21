---
name: wiser-data-foundation
description: Discover, query, search, spatially analyze, upload, ingest, review, and monitor governed WISER Data Foundation data through its REST API or MCP tools. Use this Skill whenever an agent is asked to find WISER datasets or evidence, answer from governed water data, perform graph/GIS queries, submit files or generated data, interpret quality or security states, resume an ingestion, or poll a Data Foundation Operation. Never bypass the Capability boundary or connect directly to authority/projection stores.
---

# WISER Data Foundation

Use Data Foundation as a governed data system, not as a database shell. Every operation goes through the public Capability Registry over REST or MCP. The API remains responsible for Supabase identity, Tenant/Project authorization, security ceilings, validation, audit, and projection reauthorization.

## Establish trusted context

Obtain the API origin or MCP server, short-lived bearer/delegated credential, `tenantId`, `projectId`, and `purpose` from the trusted assignment. Keep credentials in the transport configuration; never put them in tool arguments, prompts, uploaded files, logs, or handoff notes.

Start with `GET /api/data/v1/capabilities` or the corresponding MCP discovery surface. Select a Capability by its stable id and use the returned schema as the request contract. Do not guess fields from a database, UI, or previous version.

Read [capability-protocol.md](references/capability-protocol.md) before the first call. It maps the Capability Registry to REST and MCP and explains safe retries, pagination, optimistic versions, and Operations.

## Choose the narrowest workflow

- Use `data.catalog.search` and `data.catalog.get` to identify an immutable DataItem version before analysis.
- Use `data.query` for structured, bounded fields and filters. It never accepts SQL.
- Use `data.search.federated` for governed full-text/semantic/graph/geo/STAC retrieval; use `data.knowledge.search` when evidence fragments and confidence are the goal.
- Use `data.graph.expand` or `data.graph.findPath` for bounded graph traversal. They never accept Cypher.
- Use `data.geo.query` or `data.geo.intersect` for bounded GIS questions. Keep the source CRS explicit and treat Web Mercator as display-only.
- Use `data.ingestion.create` and the ingestion workflow for every new source, bulk import, API capture, generated result, or Agent-produced dataset. Track its long-running work with `data.operation.get`. Never write a formal version or projection directly.

## Query with evidence discipline

1. Search the catalog and record the selected `dataItemId`, immutable `versionId`, hashes, security level, quality grade, acceptance status, publication status, limitations, and citation requirements.
2. Pin the exact version in later calls. Do not silently resolve “latest” when the result must be reproducible.
3. Apply the smallest fields, filters, geometry, depth, and page size needed for the task. Follow `nextCursor`; do not treat a truncated page as complete.
4. Keep evidence IDs and limitations attached to conclusions. A search score ranks retrieval; it is not a quality verdict or authorization decision.
5. If a result is missing because the caller lacks clearance, report that the authorized result set is empty or restricted. Do not infer hidden content from counts, timing, or backend differences.

## Submit data through ingestion

1. Create an upload session through `data.uploadSession.create`. Upload only to the bounded, API-issued target before it expires; it is not a long-term object-store credential.
2. Complete the upload with exact size, SHA-256, and ordered multipart ETags where applicable.
3. Create one ingestion with the returned authority `assetIds`, intended uses, owner Project, and requested security level.
4. Submit with a fresh UUID `Idempotency-Key` and the current strong version precondition. The deterministic Worker scans, fingerprints, parses, profiles, executes validated transformation, runs quality checks, and aligns time/space.
5. Poll the returned `operationId` with `data.operation.get`; optionally consume bounded operation events. Preserve the same `operationId` across REST/MCP handoffs.
6. At `WAITING_REVIEW`, present the evidence, plan, deterministic quality results, before/after diff, inherited security level, and explicit conditions. Only an authorized reviewer may approve or reject.
7. After approval, continue monitoring through authoritative commit, projection, and publication. A successful upload or transform is not a published DataItem version.

Read [examples.md](references/examples.md) for complete catalog, knowledge, spatial, upload, ingestion, review, and Operation examples.

## Keep governance dimensions separate

Read [governance-and-security.md](references/governance-and-security.md) whenever deciding whether data can be used, cited, shared, or published.

- A quality grade (A/B/C) summarizes deterministic checks; it is not acceptance.
- An acceptance status records whether governed use is allowed; it is not publication.
- A publication status records release state; it does not widen authorization.
- A security level is an access ceiling/floor. Derived data inherits the highest source level and may be raised, never lowered.
- Agent confidence describes an interpretation proposal. It cannot decide the final quality grade, acceptance, publication, or security level.

## Command and recovery discipline

- Give each intended command a fresh UUID `Idempotency-Key`. After an ambiguous failure, retry only the identical Capability, actor/context, body, precondition, and key.
- Supply the current strong `If-Match: "vN"` or MCP `expectedVersion` for versioned commands. On conflict, refetch and decide; never increment a version by guesswork.
- Treat `operationId`, DataItem versions, assets, evidence, reviews, audit events, and Operation events as durable facts.
- A timeout is ambiguous. Reconcile the Operation or resource before issuing a different command.
- Cancel only the intended non-terminal Operation. Cancellation does not erase uploaded objects, versions, evidence, audit, or prior events.

## Hard boundary

Call only the WISER REST API or registered Data Foundation MCP tools/resources. Do not connect to PostgreSQL/PostGIS, object storage, Weaviate, OpenSearch, Neo4j, GeoServer, pgSTAC, TiTiler, Martin, Tika, or ClamAV. Do not invent arbitrary query, shell, filesystem, or administration tools. Do not expose tokens, signed upload URLs, internal endpoints, raw backend errors, hidden rows, or another Tenant/Project's identifiers.

At handoff, report the trusted context identifiers (never the credential), exact Capability, immutable resource/version IDs, current cursor or Operation version, idempotency status, observed governance dimensions, limitations, and the next safe action.
