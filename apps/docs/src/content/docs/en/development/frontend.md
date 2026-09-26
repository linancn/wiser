---
title: Frontend development
description: Responsibilities, routes, data access, localization, themes, and acceptance workflows for WISER Web and Docs.
docType: workflow
scope: wiser-frontend
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when creating or changing a WISER product page, documentation page, shared shell, or browser interaction
whenToUpdate:
  - when frontend application boundaries, routes, data access, identity, localization, themes, or test rules change
checkPaths:
  - apps/web/package.json
  - apps/web/src/**
  - apps/web/e2e/**
  - apps/docs/package.json
  - apps/docs/src/**
  - apps/docs/e2e/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

## Two frontend applications

| Application | Local entrypoint        | Responsibility                                                                   | Code entrypoint                                     |
| ----------- | ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/web`  | `http://127.0.0.1:3100` | WISER product UI: unified sign-in, Agent EXCON, and Data Foundation workspaces   | `src/app/[locale]`, `src/components`, and `src/lib` |
| `apps/docs` | `http://127.0.0.1:4321` | WISER Fumadocs site: architecture, protocols, runbooks, and development guidance | `src/app` and `src/content/docs/{zh-CN,en}`         |

The applications share the WISER visual language, Chinese-default policy, and light/dark capability, but they do not share runtime state. Product functionality belongs in `apps/web`; developer guidance belongs in `apps/docs`. Do not turn Docs into another product console or embed long development guides in product pages.

See the [local development environment](/en/development/local-environment/) for runtime modes and ports. See the [WISER Design System](/en/architecture/design-system/) for visual tokens, component semantics, and accessibility contracts.
See [Product interface and content design](/en/development/product-experience/) for Portal, navigation hierarchy, product naming, and user-facing copy.

## Locale and theme contract

### Product Web

- Supported locales are `zh-CN` and `en`; `/` redirects to the public `/zh-CN` Portal, and the English Portal is `/en`.
- Every product page lives under `src/app/[locale]`, so Chinese and English naturally use the same locale-free slug. For example, `/zh-CN/runs` corresponds to `/en/runs`.
- Visible copy belongs in the two dictionaries in `src/lib/i18n.ts`. Chinese is the default expression; protocol and domain identifiers such as HTTP, MCP, Run, and DataItem may remain English.
- `AppShell` owns the Portal entry, primary system switching, current identity, theme, and locale switching; its second row contains only the current system's workspace navigation. New pages continue to use that shell instead of introducing parallel global navigation.
- Themes consume semantic tokens. `wiser-theme` persists the choice, first use respects the system preference, and `data-theme` is set before hydration. Light and dark preserve the same hierarchy, state meaning, and actions.

### Documentation site

- Chinese content lives in `src/content/docs/zh-CN` and its default routes have no locale prefix. English content lives in `src/content/docs/en` and routes start with `/en`.
- A translation pair uses the same relative path and slug and appears in the same position in both `meta.json` files.
- The Fumadocs provider supplies Chinese/English, light/dark/system themes, and static search. New content must remain readable in both languages and both color themes.

## Product Web routes

| Workspace                  | Routes                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| WISER Portal               | `/[locale]`; anonymous visitors may read the platform and system introduction                                    |
| Unified identity           | `/[locale]/login`, `/[locale]/auth/login`, `/[locale]/auth/callback`, `/[locale]/auth/sign-out`                  |
| Agent OAuth consent        | `/oauth/consent` entry, `/[locale]/oauth/consent` page, and `/[locale]/oauth/consent/decision` form              |
| Agent EXCON scenarios      | `/[locale]/scenarios`, `/[locale]/scenarios/[scenarioId]`                                                        |
| Agent EXCON runs           | `/[locale]/runs`, `/[locale]/runs/[runId]`, plus `collaboration`, `diagnostics`, `trace`, and `replay` subroutes |
| Data Foundation overview   | `/[locale]/data-foundation`                                                                                      |
| Data Foundation workspaces | `explore`, `catalog`, `ingestions`, `quality`, `search`, `knowledge`, `graph`, `geo`, `map`, and `capabilities`  |
| Data Foundation detail     | `catalog/[dataItemId]`, `ingestions/[ingestionId]`, `operations/[operationId]`, and `lineage/[dataItemId]`       |

In Supabase mode, Portal, sign-in, and Auth transport routes are public. Other localized product routes require verified authenticated claims in Proxy; anonymous requests retain their target and redirect to locale sign-in. `WISER_AUTH_MODE=off` remains a local reference-preview mode only.

The public OAuth entry keeps its browser redirect relative to the Web origin. The localized consent page needs a verified user Session and reads eligible Projects from the WISER API after Supabase associates the authorization request with that user. Form decisions check `WISER_PUBLIC_WEB_ORIGIN` in production, then revalidate the selected Project, mode, level, and duration server-side. Approval creates the bounded WISER grant before Supabase issues an authorization code; denial creates no grant.

Pages are Server Components by default. Add a Client Component only for browser interaction, browser APIs, or local state. Do not move data access and identity logic into the browser merely because a parent view contains an interaction.

Portal and Docs expose a localized Agent setup copy action backed by the server-configured public `WISER_AGENT_SETUP_URL`. Clipboard denial reveals selectable instructions; success reports only that copying completed. No credential or project data is attached to the prompt. The [Agent setup protocol](/en/protocols/agent-setup/) defines release verification and the separate connection check. Production Docs need the intended URL at build time because their pages are prerendered.

Invitation confirmation lives at `/[locale]/auth/invite` with POST-only acceptance at `/auth/accept`; the protected `/[locale]/account/password` uses POST `/auth/password`. The shared account control links to self-password setup. These pages reuse the login styles and locale dictionaries; see [invited-reader security requirements](/en/architecture/unified-auth/).

## Agent EXCON read models

Agent EXCON pages support two explicit data modes:

| Mode        | Purpose                                                                      | Failure behavior                                                                |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `reference` | Default deterministic design reference, build, and end-to-end test data      | The page is clearly labeled as a design preview                                 |
| `live`      | Server Components read operator projections from the Agent EXCON v2 HTTP API | An actionable unavailable/error state appears; reference data is never mixed in |

The server-side `AGENT_EXCON_WEB_DATA_MODE` selects the mode. In live mode, `AGENT_EXCON_API_INTERNAL_URL` supplies the server-only API origin; requests use `cache: no-store`, and the verified current user access token remains server-only. In Supabase mode, EXCON and Data use the same server-only session verifier; a static `WISER_WEB_OPERATOR_TOKEN` is limited to local Auth-off development. When a current DTO does not provide the required fact, show a coverage gap or empty state. Never fill it from the reference sample or infer Agent, span, replay-perspective, or verdict facts in the frontend. Reference collaboration shows a synthetic exercise preview label; completed live runs keep the ordinary manual-refresh state.

## Data Foundation data and identity

Data Foundation has no reference mode. Every page reads the live API through the server-only DAL in `src/lib/data-foundation-dal.server.ts`. Missing configuration, authentication failure, denied authorization, contract-invalid responses, and unavailable upstreams converge to classified failure states instead of fabricated data.

The access sequence is:

1. The Next.js proxy and Server Components use the Supabase SSR cookie session.
2. The server verifies user, session, role, and expiry through `getClaims()`, then reads the access token through `getSession()` and confirms that both refer to the same session.
3. The DAL forwards the Bearer token plus tenant, project, and purpose context to the WISER API. Requests disable caching and bound timeout, media type, and response size.
4. The browser receives only the Supabase URL and publishable key. Database credentials, service-role keys, internal API origins, operator tokens, and raw upstream errors never enter Client Components or serialized props.

Map tiles also use a same-origin Web route whose server proxy adds identity and scope. Never put an internal GIS origin or access token in a map URL.

The graph page uses client-only lazy loading of G6 5.1.1, bounded governed data, shared theme tokens and a keyboard entity list with exact version/evidence links. `e2e-live/query-visualization.spec.ts` checks the real HydroATLAS graph and long search excerpts at desktop/mobile widths. It requires the admitted research case and explicit loopback test credentials.

## Implement a new page

1. Identify whether the page belongs to Portal, Agent EXCON, or Data Foundation, then preserve the `Portal → system → workspace → domain object` hierarchy and existing domain vocabulary.
2. Add one locale-free slug under `src/app/[locale]`; create one page implementation and source Chinese/English content from isomorphic dictionaries.
3. Read data in a Server Component by default. EXCON uses the existing read-model source; Data Foundation uses the server-only DAL. Never access a database, projection store, or internal GIS service directly.
4. Render the applicable loading, empty, authentication, authorization, contract, and unavailable states explicitly. Preserve a recovery action in failure states.
5. Use the shared shell, semantic tokens, and existing component primitives. A new primitive should serve multiple pages rather than wrap one local style.
6. Add Chinese and English copy, accessible names, titles, metadata, and locale-switch destinations together.
7. Write a failing unit, contract, or route test before implementation, then use Playwright to accept the rendered result.

## Tests and browser acceptance

Use these commands for fast feedback:

```bash
pnpm --filter @wiser/web test
pnpm --filter @wiser/web typecheck
pnpm --filter @wiser/docs typecheck
```

Before handoff, run the affected application builds and end-to-end tests:

```bash
pnpm --filter @wiser/web build
pnpm --filter @wiser/web test:e2e
pnpm --filter @wiser/docs build
pnpm --filter @wiser/docs test:e2e
```

These standard Playwright configurations start isolated development servers and primarily verify reference/fixture-driven routes, locales, themes, and interactions. They do not prove unified Auth, the Data database, or an EXCON live credential. `pnpm stack:full:up` / `pnpm data:smoke` covers the authenticated Data vertical slice.

To verify EXCON live in the complete stack, sign in through Supabase as a user with the EXCON operator role, with `AGENT_EXCON_WEB_DATA_MODE=live` and the server-side API origin configured. The read model forwards that verified session; authentication failures never fall back to a service token. Reference-only tests do not prove live/Auth E2E.

The reproducible model-free EXCON live Web path is the scripted Showcase. It starts an isolated Lab/API/Web, configures the `live` read model with a host-only operator token, and returns the `/collaboration` URL from status:

```bash
pnpm showcase:preflight
pnpm showcase:start --profile scripted
pnpm showcase:status
pnpm showcase:stop
```

This proves the live read model and collaboration page, not automated Playwright interaction. Always stop afterward and verify TTL/credential cleanup.

Playwright locators use user-visible roles, labels, text, or stable test IDs. Apply this checklist to every new UI:

- Chinese and English preserve the same routes, information, states, and actions; English pages contain no untranslated Chinese narrative.
- Light and dark retain sufficient contrast, and switching theme or locale preserves the current workspace.
- Desktop and a 390px viewport have no horizontal overflow, and primary actions do not depend on hover.
- Every interaction is keyboard reachable, focus is visible, state never relies on color alone, and animation respects reduced motion.
- The page produces no browser exception or unexpected console error, and failures do not expose credentials or raw upstream response bodies.
- Tests protect the EXCON reference/live boundary and Data Foundation's live-API-only boundary.
- New routes, dictionary keys, data contracts, and authorization failures have focused coverage; screenshots support visual comparison but do not replace semantic assertions.
- Related architecture, protocol, or development documentation is updated and passes Docpact plus root `pnpm verify`.

## Current Data Foundation workspace behavior

The `/[locale]/data-foundation/explore` workspace shares the strict exploration contracts with the API. A compact query bar, resource table and selection inspector keep the result area near the top of the viewport. Server rendering starts or resumes an authorized result set; subsequent queries pass through the session-verified Next.js endpoint `/api/data-foundation/explore`. Filters start a new version manifest; paging keeps the same `queryId`. Keyboard-operable resource names expose exact versions, readiness and source limitations. Unknown analytical counts remain explicit instead of becoming zero.

The explorer uses the official AMap basemap with transparent MapLibre GL JS and react-map-gl business overlays, loaded only when opening a map. `apps/web/scripts/prepare-maplibre.mjs` copies the matching worker and shared module into a versioned same-origin public directory before dev/build. Generated vendor files are ignored by Git. Display coordinates and cameras are synchronized at the AMap boundary; authorized queries and originals retain their source coordinates. AMap logo and attribution stay visible.

The exploration statistics tab uses Apache ECharts, loaded on demand with the SVG renderer and only the required chart components. It charts server-computed readiness counts for the full authorized query. Selecting a bar or its keyboard-accessible text equivalent applies the same readiness filter to resource exploration. Chart colors follow semantic tokens; resize/theme observers and the chart instance are disposed on unmount. Resource counts must not be presented as record counts or scientific observations.

Exploration clears the current query, selection, asset details and rendered views when a response invalidates its authorization or immutable membership, or when the advertised result deadline is reached. Background/page restoration checks the same deadline. Late failures from an older query cannot clear a newer result, and aborted requests cannot restore stale data. Query form conditions remain available for a fresh authorized query. Temporary map failures unload the canvas and offer reload without exposing upstream diagnostics.

Record exploration includes an expandable conditions form with up to eight typed comparisons, scalar sorting and an optional 1–32 column selection. Text identifiers retain leading zeros; blank or non-finite numeric input is rejected. Applying conditions creates a new authorized single-version/file query, clears selection, adds a history entry and opens its records view. The same predicates govern records, map tiles and record provenance. Reload restores the configuration from the authorized query; clearing it restores the selected version without record conditions. Numeric comparisons use source values without inferring or converting units.

The statistics view includes source-record aggregation after selecting a resource. Its field controls remain distinct from resource-readiness counts. Charts have an exact-value table and keyboard-operable group selection. Units remain explicit and unknown groups cannot silently become an incorrect null-only filter.

Exploration 1.8 adds typed time predicates and sorting, and hour/day/month/year aggregation. Source formats are `iso-offset`, `dmy-local` or `ymd-local`; `utcOffsetMinutes` is an explicit fixed offset from −840 to 840, not an inferred time zone or daylight-saving rule. ISO source values retain their own offset. Naive source times require the configured offset, which also defines calendar buckets. Invalid dates become ungroupable rather than normalized. Boundaries are UTC strings with up to six fractional digits, and ranges use inclusive `gte` plus exclusive `lt`. Source strings remain unchanged. The browser supports calendar lines, complete-bucket brushing and equivalent keyboard range controls; unit series remain separate. All views and MVT use the same conditions. The 1.7 discovery schemas remain immutable.

Exploration 1.10 adds immutable `spec.spatialBounds` in WGS84 west/south/east/north order. It uses verified geometry intersections across records, aggregates, graph record lookups and query MVT before clustering. Resource and provenance overviews contain matching versions; source-readiness metrics retain their documented indexed-content meaning. The manifest keeps the underlying authorized pins so clearing or changing the area via `baseQueryId` does not refresh analyses or lose the original population. Every pinned member is reauthorized even when outside the current area. The map offers point/line/polygon visibility, a legend, local-font cluster counts and viewport filtering; layer visibility is presentation only and never changes query authorization or counts. Unverified coordinates are excluded explicitly. The 1.9 discovery schemas remain immutable.

Graph exploration provides keyboard-operated file, evidence and record expansion, bounded neighbor pagination, labeled relation toggles and directed path controls scoped to the current page. Path highlighting updates G6 node/edge state without replacing its canvas. Both languages show the count grain, truncation and recovery action; switching focus clears path endpoints and cursors.

The Data workspace navigation groups search, knowledge and specialist GIS/graph tools under the exploration workspace while preserving their existing deep links. Exploration offers these specialist routes in its toolbar. Resource tables alone may hide the provider column on narrow screens; record and aggregate tables retain every selected field and unit in an internal scroll area. Source statistics keep whole-resource readiness in a separate disclosure that mounts its chart only when open. Source-hierarchy graph layouts use vertical worker layouts below 560 px of canvas width and expose keyboard-operated zoom, fit and selected-node focus controls. Viewport changes use no animation.

On screens up to 900 px, a selected source can be inspected in a non-modal bottom drawer. Opening moves keyboard focus into its labeled region; collapse or Escape returns focus to the toggle without clearing selection. Clearing the selection returns focus to the active view tab when needed. Desktop inspection remains inline and scrollable. G6 internal canvas layers are removed from the tab order; named viewport controls and the source node list provide the keyboard interaction.

The Portal derives its primary action from a verified session: authenticated users enter the Data workspace; anonymous users sign in. Catalog browsing uses 25-row cursor pages and a keyboard-focusable, internally scrolling table, preserving the name query on continuation and return to the first page. Source, publication, quality and security remain visible; the details explain check scope and content readiness.

Search and knowledge pages send 10-row cursor requests and retain the keyword on continuation and first-page links. Display names are enriched on the server through the same authorized DAL, with at most six concurrent exact-version resource reads, per-request deduplication and no cross-session cache; unavailable optional names fall back to a resource link. Catalog and quality use 25-row cursors. The explorer also accepts a complete `dataItem`/`version` URL pair, validated by the shared query schema and reauthorized by the HTTP API. This pair cannot be combined with an existing query or saved-view identifier. The intake and Agent access pages reuse the configured public Agent setup URL. `e2e-live/data-foundation-product.spec.ts` covers the admitted research case, cursor navigation, version-preserving view entry and the locale/theme/viewport matrix.

Exact source bytes are available through `GET/HEAD /api/data/v1/tenants/{tenantId}/projects/{projectId}/versions/{versionId}/assets/{assetId}/content`. The API repeats the existing asset/version authorization and audit, signs only the internal storage endpoint, and streams with a two-minute deadline and single-range support. It does not expose a signed URL. The session-verified Web endpoint `/api/data-foundation/assets/{versionId}/{assetId}` provides an explicitly named attachment or an allowlisted inert preview; it strips upstream cookies and uses no-store, nosniff and a sandbox content policy. File downloads are independent of bounded query-page exports. Resource pages open parsed content before governance metadata, preserve exact version/file identities, and offer paged tables, source documents, structured values and linked map/graph views. Nested structures mount lazily in bounded groups and source labels remain available alongside display labels.

Two-dimensional indexed raster bands and NetCDF variables (at most 65,536 pixels) render from exact numeric values with transparent masks, a per-band legend and keyboard-accessible row/column inspection. Zero and negative values are preserved. Missing, nonnumeric or higher-dimensional arrays retain a structured view and an original-file download; they are not rendered as invented imagery.

Native PDF previews use the exact `application/pdf` response type with nosniff and restrictive CSP, without an iframe sandbox that would disable the browser PDF renderer. HTML and other document responses retain the server sandbox policy. Client file extensions cannot relax the response policy for HTML.

Resource content mounts `DataReconciliation` for two fully parsed table assets. Its same-origin reconciliation route uses the verified-session DAL, strict Capability schemas, client idempotency keys and versioned review preconditions. Candidate and human-verified observation metrics are batch-scoped. Result and source-member tables have bounded independent pages; narrow layouts scroll within the table. Access denials clear retained evidence and invalidate in-flight responses.

## Resource checks

The resource content workspace exposes acquisition and use checks for the selected file. Explicit declarations and unknown states are shown separately from source-backed server facts. The authenticated same-origin `/api/data-foundation/assessment/[action]` adapter bounds bodies to 128 KiB, uses the existing DAL, retains command keys for ambiguous retries and clears report content on source denial. Records are loaded on request with bounded pagination; no initial report is fabricated.

The catalogue exposes an on-demand acquisition overview with an explicit resource denominator, target selector, next-step filters and bounded resource links. Query text is retained; a new query remounts the panel. Unknown records never appear as zero-quality or inaccessible.

Resource content includes a source-version business-relation disclosure. Lists select an explicit review status; only approved pages mount the existing accessible knowledge canvas. Entity selection binds mapping and source keys. Candidate-file import validates the current source version, evidence links point to exact original assets, and review actions retain their command key on ambiguous failures. A human reviewer must supply a rationale; safe errors expose no upstream details.

Business relations accept up to sixty-three additional version-specific platform source links. Pending graph preview requires explicit opt-in and retains its pending notice. Nodes preserve source identities or explicit referenced identities. Each relation exposes its source, evidence, record nature, time/location roles and applicability. Counts and continuation are bounded. Source spatial links do not imply available or verified geometry.

The catalog URL uses a strict `relations` JSON parameter and `#business-relations` anchor for the source-local business graph. `relation-navigation.ts` validates source/version UUIDs, at most sixty-three distinct additional sources, review status, pending opt-in, a scoped entity identity and 1–10 pages. It rejects unknown fields, duplicate parameters and payloads over 8192 characters. No evidence text or credentials enter the parameter. Native browser history preserves Next.js state. Opening or restoring history reissues session-verified list requests with 100 rows per page; permissions are never restored from the URL. Subsequent pages accumulate by assertion ID, and interrupted restoration cannot repaint a newer view. This transport does not change the saved exploration-view contract or grant project sharing.

Relation lists and deep-link restoration share the contract limit of 63 additional sources. Oversized scopes are rejected rather than truncated. Restoration reauthorizes each source; the API page size remains 100 and cumulative browser loading remains bounded to ten pages.

Business graph source links add a bounded, validated `returnRelations` context. Exploration preserves it across query URL replacement and tab changes; the return action reopens the original graph scope, review state and focus with fresh authorization. It is a navigation origin only. The authenticated regression `e2e-live/business-relation-navigation.case.ts` uses `WISER_WEB_LIVE_RELATION_URL` for a real loopback case and the existing live-test credentials. It tests source records, refresh, map/record tabs and return; it does not establish map alignment or scientific validity.

Business relations offer optional type and time filters over loaded, authorized rows. Either endpoint can match the selected kind; time-role selection is exact. Date comparisons overlap explicit source periods, preserving year/month precision as intervals. Missing, incomplete, reversed or unrecognized periods remain unknown; a point observation is used only with an explicit observation-time role. The unknown-period option applies to date filtering after type/role selection. The graph and evidence list use the same subset and show matched, loaded and total counts separately. Pagination retains nonmatching rows so clearing filters restores them. Strict URL filters survive refresh, history and source-exploration return; they neither query new data nor claim source maps/records use the same temporal conditions. Node labels include localized types without merging source identities.

An observation node may declare `urn:wiser:record:<recordId>` as its external ID, scoped to its own source version or explicit referenced source. The Web offers exact record and spatial-content links only for a valid UUID binding on an OBSERVATION node; it never infers a record from a label or assigns geometry to a document. These links retain the applied graph return context and reauthorize/read all record identities on opening. The URI is a navigation declaration, not server attestation of scientific identity or professional approval; evidence and pending status remain visible. Ordinary external IDs are unchanged.

Without a saved page view, an exact-record entry requests the selected record directly so off-page records are immediately visible. Mismatched response identities fail instead of substituting page one. “Browse records in this file” resumes file pagination under the same query, clears exact focus from the URL and retains the business-graph return context. Existing saved views preserve their page and cursor history.

Record inspection offers an on-demand reverse lookup of explicit record bindings through authorized, paged relation lists. It retains a valid case source scope and relationship filters, defaults to approved records without a case, and requires an explicit pending selection otherwise. Partial, empty and unavailable results are distinct; denial clears retained bindings. Opening a match focuses its source-bound business node, while the previous graph return action remains independent. Selecting a different record aborts and clears the previous lookup; matching never uses labels or invented geometry.

Business relation links optionally persist `revisionMode: "all" | "current"`; omitted means all history. Current display collapses only explicit same-DataItem, same-triple replacements in the same approved or pending review queue, after the full unfocused scope is loaded. It never chooses by timestamps, resolves competing branches, or promotes pending changes over approved knowledge. Incomplete pages, focused objects and exact history retain all loaded rows and disclose that boundary. Cyclic or invalid replacement links do not hide evidence. Type/time filters run after revision selection, and exact predecessor links still reopen immutable history. This is presentation over authorized API rows, not a new approval or authority state.

Business exploration opens a multi-source problem/evidence graph when the saved query contains business conditions. The default network includes all authorized observation detail and shows complete/scoped counts; selecting an object opens its evidence while retaining the full network. Bound-record and map links preserve the query. Authority status stays visible and source lineage remains a separate view for ordinary queries. Both locales use the shared graph canvas and design tokens.

Business maps page through the authorized exploration map response before rendering a complete bounded GeoJSON collection, with the existing display-coordinate conversion. They do not use legacy query tiles, whose database function only understands the older source/record filters. A changed, duplicate, incomplete or oversized collection fails visibly; it is not drawn as a complete result.

Business record inspection retains the persisted query and its review state, searches the complete bounded relation result and returns to the selected business object. Explicit record links apply to documents and other entity kinds as well as observations. Business maps display only scoped record geometry; moving the viewport does not filter the business question. Combined viewport and business conditions are rejected until relation-level spatial semantics are defined.

Business object captions are derived from already loaded, authorized relation rows. Source links follow each object’s canonical reference, not the row that mentions it; diagram labels remain concise. Missing titles and same-source duplicates retain neutral numbered identifiers.

Business exploration offers an optional path reader over the complete authorized relation set. Users select two source-qualified objects and inspect one shortest connection of at most eight edges, with original directed statements and evidence. Traversal may follow either end of a relation for reading only; it does not infer causation, approval or new edges. This local diagram inspection does not change the shared records/map query; changing endpoints clears the displayed path.

Catalog navigation shares `catalog-route.ts`: new links use `version`, while `versionId` remains an unambiguous legacy alias. Duplicate, malformed or conflicting pins fail instead of falling back to latest. Saved relation views canonicalize the pin and preserve it across source/return navigation and refresh.

Resource content, selected explorer resources/records and dedicated version maps share the spatial-source disclosure. Requests are made only when opened, with 25 latest-per-file reports per page. Record selection filters the exact asset; version-level views label each original separately. Selection changes abort pending work and clear state; wrong-scope or denied responses never retain source claims. Scale warnings stay visible when the disclosure is closed, including at fine zoom. Source links preserve version and asset IDs, and independent layers retain their original geometries.

The version map exposes optional single-band raster display controls with a range legend, explicit missing code and entered/unknown unit. Apply and reload detach the old raster source before disposing its Worker, retaining camera, opacity and layer order. Original-color reset clears the active legend. Errors remain visible until reload. Both map surfaces request a flat continuous-zoom basemap and restrict the overlay to integer zoom with a visible explanation when AMap reports a non-WebGL fallback. Browser acceptance must check real imagery, two zoom levels, opacity, missing versus zero values, failed/retried tiles and both locales/themes at 390px; a successful tile response alone does not establish positional accuracy.

### Business graph reading and presentation

Business problem graphs keep the full authorized relation set across five reading perspectives (panorama, source comparison, object neighborhood, evidence tracing and time) and planar, orthographic category-layer, or spatial-anchor presentation. Display settings and bounded camera coordinates are URL state; same-query record/map links retain them and the exact selected assertion. Source comparison places source categories and business content in separate columns; explicit one/two-step neighborhoods preserve each statement's original direction. The existing bounded path reader opens in the evidence perspective. Source/title grouping is a disclosed reading aid, with unknown classification retained; it never changes registration metadata, identity or knowledge approval. Temporal grouping uses only explicit observation/event roles on the object's own source assertions, preserving unknown and multiple periods.

The business scene uses deterministic category positions and SVG projection; ordinary provenance and optional six-assertion reading retain G6. Layer titles occupy a separate caption gutter with connector lines. Continuous pointer/pinch/keyboard zoom changes the camera without recomputing positions or dropping edges. Labels appear progressively; selected nodes/edges and their evidence remain inspectable in a keyboard-accessible list. Hover previews direct connections; selection pins evidence and dims the full-network background. Crossing-edge hit testing offers the actual candidate assertions. Evidence includes original polarity, exact source version, table/paragraph locator, limitations, review state and preceding-assertion links.

Spatial presentation uses the existing complete, bounded HTTP map query and exact data-item/version/record bindings. It keeps original point/line/area geometry, converts display coordinates through the existing map adapter, and retains unlocated knowledge separately with its original relations. Dashed connectors place document labels around a geometry's display center; neither labels nor their centers become new point features or business relations. Geometry lookup rejects changed scope, incomplete pagination and denied access. Map movement does not change the business question. Location precision and knowledge review remain separate. No source acquisition, parser rerun, migration or business-data write is performed by scene controls.

Spatial scene requests check cancellation before dispatch and after response/body completion. Abandoned requests cannot invalidate the active scene or continue pagination; partial page failures never expose an incomplete geometry set, and retry rechecks the same scoped query.

BusinessQuery v2 selects approved and pending rows together without changing assertion states. The business heading and record relationship selector use a distinct mixed-scope label; reverse record lookup validates each returned state against the query scope and retains the same query ID. Historical single-state links remain valid.

`load-exploration.server.ts` shares default project creation and explicit query/saved/fixed-version restoration across the home and exploration pages. The homepage passes its operational/status section as a streamed server component beneath the same client workspace; status failure does not suppress an available query. Client navigation canonicalizes a successful default entry to the existing exploration URL. Saved-topic requests are deferred until the topic disclosure opens.

Both entry routes retain the streamed operational/status section after URL normalization and refresh. Query failures offer an explicit project-overview restart; empty resource filters are treated as an unfiltered entry, while malformed text is rejected rather than discarded.

Reference Web browser tests wait for the Data Foundation workspace to respond before starting UI interactions. This compiles the graph workspace during server readiness, rather than consuming the existing navigation timeout with on-demand development compilation. The readiness budget is 120 seconds; navigation, locale, theme and content assertions remain unchanged. Reference runs retain `next dev`: production mode forbids the reference suite’s disabled-auth configuration. This does not establish live API or deployed-environment acceptance.

The root unit/coverage runner defaults to two workers to bound DOM and coverage contention on development hosts with preview services. Test deadlines, assertions and coverage thresholds are unchanged. Use an explicit Vitest `--maxWorkers` value for a measured concurrency experiment; a focused pass does not replace full verification.

The opt-in account menu opens `/[locale]/account/access` for personal access and authorized project member actions. See [Unified Auth](/en/architecture/unified-auth/#project-access-workspace) for configuration and real-session acceptance. It retains the existing shell, locale and theme; it is not a new peer business system.

## Project resource coverage

The normal `account/access` workspace opens an access overview and reads resource coverage for the selected tenant/project through the same-origin `GET /api/platform/resources` adapter. The server-only DAL forwards the verified current session to Data Foundation; selecting context never confers membership, Data scopes or resource access. Query parameters cannot provide an actor, grant or token. Counts and readiness distributions come from the full server-owned query manifest, while each resource page is bounded to 20 rows. Pagination retains the query identifier; filters create a new query. Project changes, denied access, expiry and failed refresh clear old content; aborted earlier requests cannot repopulate it. Unknown analysis totals remain unavailable.

Resource rows distinguish content, spatial and graph readiness and expose fixed-version details. Optional counting explanations reuse keyboard/touch-accessible contextual help. Chinese/English, theme and narrow-screen acceptance use the same authenticated page. This coverage surface does not itself grant access, infer professional approval, or establish cross-resource temporal coverage.

## Source permission review

The source-permission tab uses the verified-session proxy for bounded proposal history and independent publication, rejection, withdrawal and revocation. The server separately checks explicit stewardship appointments. Historical decisions and current permission states remain distinct, with their check time. Project changes, denied refreshes and page hiding clear retained rows; known term boundaries trigger rechecks. Uncertain mutation retries retain the same idempotency key. Source registration and a management-metadata picker remain separate integration work; this review surface grants no personal reading access.

## Resource package and preset definitions

Managed projects expose resource-package and preset tabs only to current project managers. The live projects response carries the optional `resourceAccessEnabled` flag; its absence preserves existing navigation. Both tables retrieve at most 20 latest definitions per page. Package creation selects explicit fixed versions from the current authorized coverage query, retains selections across pages and deduplicates exact item/version pairs. It never selects unread pages or grants access. Preset updates create an immutable version and retain the expected previous version.

The same-origin adapter verifies session, origin, bounded input and idempotency keys before forwarding definitions. Ambiguous retries keep an identical command key; changed inputs get a new key. Project changes and failed authorization clear retained definitions and close editors. Successful saves explicitly distinguish stored definitions from effective member grants. Creation remains unavailable while the current definition list is loading or denied.

The resource-enabled project workbench includes a batch-access tab for managers and approval reviewers. Managers select only explicitly loaded members and immutable package/preset versions; approval-only users see review controls without member-management controls. Applicant/recipient self-approval controls are absent, while the server independently enforces the rule. Preview, approval and execution statuses remain distinct, receipts retain per-recipient history, and retries reuse unchanged command keys (including fixed preview timestamps). Project changes abort stale requests. The same verified-session BFF handles bounded lists and all four batch actions.

Batch member details show frozen differences by action, with an explicit unknown state for older previews. Changed grants prompt a fresh application; current effective access is never inferred from a historical receipt.

The account control links to `/[locale]/account/agents` for the current user’s AI/MCP connections. The verified-session page shows bounded ownership, status and expiry. Its native disconnect form uses same-origin protection and reports partial provider revocation so the user can retry before reauthorizing in the original client.
