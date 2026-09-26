---
title: Product interface and content design
description: The consistent WISER contract for portals, system navigation, product names, user-facing copy, states, and new systems.
docType: workflow
scope: wiser-product-experience
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when creating or changing a product page, navigation, visible copy, empty state, failure state, or sign-in guidance
  - when adding a business system to the WISER product interface
whenToUpdate:
  - when platform information architecture, product naming, public access, copy standards, or experience acceptance changes
checkPaths:
  - apps/web/src/**
  - apps/web/e2e/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: 23b31dd585227784d28a6cf8dec88be77fa8e491
---

## What this guide governs

This guide governs the product surfaces that users see and operate in `apps/web`. See the [WISER Design System](/en/architecture/design-system/) for visual tokens, typography, themes, and component semantics. See [Frontend development](/en/development/frontend/) for routes, Server Components, data access, and Playwright.

The product UI is not developer documentation, an architecture diagram, or an operations runbook. It helps a user answer:

1. Where am I in the platform?
2. What task can I complete here?
3. How does the current state affect my work?
4. What can I do next?

Implementation details, internal services, configuration, and troubleshooting belong in documentation, logs, or controlled operator tools—not ordinary business pages.

## Fixed information hierarchy

Every system uses the same hierarchy:

```text
WISER Portal
  → business system
    → system workspace
      → domain object and object-local tabs
```

| Level            | Purpose                                                   | Current examples                                           |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------- |
| Portal           | Explain WISER and its systems, then guide unified sign-in | `/zh-CN`, `/en`                                            |
| Business system  | Switch between peer business boundaries                   | Data Foundation, Agent EXCON                               |
| System workspace | Complete a stable task within one system                  | Catalog, ingestion; scenarios, exercise runs               |
| Domain object    | Inspect one DataItem, scenario, Run, or task              | Run overview / collaboration / evaluation / trace / replay |

Rules:

- The WISER logo always returns to the current locale Portal. Portal is not a third business system.
- Primary system navigation places the foundational Data Foundation before Agent EXCON.
- Portal and sign-in show no system-context navigation.
- Context navigation appears only inside its system. Object-local tabs never become platform navigation.
- A new system joins primary navigation and never creates a parallel header, identity entry, or theme control.

## Product naming

| Concept            | Chinese product name | English product name | Rule                                            |
| ------------------ | -------------------- | -------------------- | ----------------------------------------------- |
| Platform           | WISER                | WISER                | Never translated or presented as a system label |
| Data Foundation    | 数据基座             | Data Foundation      | First primary business system                   |
| Agent EXCON        | 智能体演练场         | Agent EXCON          | Chinese UI does not show the English brand name |
| Scenario workspace | 演练场景             | Scenarios            | Agent EXCON context task                        |
| Run workspace      | 演练运行             | Exercise runs        | Agent EXCON context task                        |

Protocol names, code identifiers, and product labels are separate. URLs, DTOs, and database fields may retain stable English identifiers while visible headings follow this table.

## Public entry and sign-in boundary

- `/` redirects to the Chinese Portal at `/zh-CN`; `/en` is the isomorphic English Portal.
- Portal, sign-in, and Auth transport routes allow anonymous access.
- In Supabase Auth mode, Data Foundation and Agent EXCON workspaces require a verified Session. Anonymous requests preserve the target and redirect to the matching locale sign-in page.
- `WISER_AUTH_MODE=off` is an explicit local reference-preview mode and is never a production identity mode.
- Anonymous visitors may understand both systems on Portal, but Portal never reveals project data, run data, or invented business metrics.
- Sign-in explains the organization account, organization boundary, and project access. Supabase, cookies, tokens, and publishable keys stay in developer documentation.

## Product language

### Writing order

When needed, copy answers in this order: user goal → current state → impact → next action. One or two sentences are usually enough.

| Surface           | Write                                                          | Do not write                                                |
| ----------------- | -------------------------------------------------------------- | ----------------------------------------------------------- |
| Page introduction | What task the user can complete                                | Which database, queue, projection, or DTO implements it     |
| Empty state       | What is absent and what the user can do now                    | “API not available,” fixture disclaimers, fabrication talk  |
| Failure state     | What happened, whether work is affected, and recovery          | HTTP status, env vars, internal URLs, health-check commands |
| Permission state  | Why this account cannot proceed and who can grant access       | Role/Scope/Tenant resolution internals                      |
| Specialist detail | Trace, Span, CRS, version, and hash needed for the actual task | Infrastructure unrelated to the task                        |

Ordinary product pages must not expose:

- environment-variable names, credential names, internal hosts, or internal URLs;
- HTTP 401/403/5xx, raw error codes, or upstream response bodies;
- implementation terms such as DTO, DAL, Capability Registry, Worker, or Outbox;
- development narratives about reference fallback or missing API coverage;
- instructions asking users to inspect databases, object storage, logs, or health endpoints.

If support needs correlation, show only a non-sensitive support ID and keep the technical cause in server logs.

## State component contract

- Empty states describe the current scope and provide one executable action. If no action exists, say when or who will provide the content.
- Failure states contain a short title, impact, recovery guidance, and primary action. `role="alert"` announces only this user-safe content.
- Keep the same action name from button through progress and completion feedback.
- State uses text and shape in addition to color.
- Raw protocol codes appear only where a specialist task needs them; do not repeat a code inside every status badge.
- Never mix samples, caches, or inferred values into live business state merely to make a page look populated.

## Localization and implementation

- Every visible string belongs in the isomorphic dictionaries in `apps/web/src/lib/i18n.ts`; components do not scatter `locale === ...` copy branches.
- Write natural, professional Chinese first, then produce semantically equivalent English. English must neither add nor omit facts, state, or actions.
- Explicitly localize third-party accessible names; never rely on browser or library defaults.
- Centralize navigation order and path matching in pure configuration/functions. A component must never assume “not Data Foundation means Agent EXCON.”
- Servers may classify detailed failure causes, but browsers receive only safe product copy and an optional support ID.

## New-system checklist

1. Add one unique primary-system ID, stable entry route, and bilingual product name, with a peer business responsibility.
2. Reuse Portal, Header, unified sign-in, theme, locale, and Footer. Do not add another platform shell.
3. Define a small set of task-oriented context workspaces; keep object tabs on object pages.
4. Add Chinese and English Portal descriptions, navigation, pages, empty states, failures, and permission states together.
5. Confirm anonymous users see only intentionally public system descriptions; project content requires unified Session plus system authorization.
6. Add pure navigation tests and Playwright coverage for Portal, both locales/themes, desktop, 390px, keyboard, reduced motion, sign-in continuation, and technical-information non-disclosure.

## Acceptance

Every product UI change verifies:

- Portal → system → workspace → object hierarchy is clear, with no duplicate or inverted navigation;
- Chinese has no unapproved English product name and English has no untranslated Chinese narrative;
- the first visual layer contains no environment variable, internal URL, HTTP status, or developer recovery step;
- light/dark and desktop/390px have no horizontal overflow and primary actions do not depend on hover;
- skip link, primary/context navigation, theme, locale, and primary actions are keyboard reachable;
- reduced motion removes non-essential animation;
- ordinary failures expose no server secret or raw upstream response.

The `/[locale]/data-foundation/explore` workspace shares the strict exploration contracts with the API. A compact query bar, resource table and selection inspector keep the result area near the top of the viewport. Server rendering starts or resumes an authorized result set; subsequent queries pass through the session-verified Next.js endpoint `/api/data-foundation/explore`. Filters start a new version manifest; paging keeps the same `queryId`. Keyboard-operable resource names expose exact versions, readiness and source limitations. Unknown analytical counts remain explicit instead of becoming zero.

Resource readiness precedes analytical inspection. Record views expose original column labels, bounded pages, source filenames and hashes without inferring units. Map selection retains the version and source record in the Inspector. The map distinguishes viewport features/clusters from the total number of records representable in Web Mercator.

Map status separates display-coordinate conversion from independent position verification. Exploration always explains that renderable geometry does not establish positional accuracy, and that zooming cannot increase source precision. Detailed use requires checking the source, derivation, time and applicable scale; no blanket verified-alignment label is shown.

The specialist map opens the requested area even when a selected raster has no feature or STAC extent. Basemap readiness, source-file availability, and correct raster alignment remain separate checks; visible pixels alone do not prove a complete or aligned overlay.

Exploration summaries, resource tables and inspectors label indexed totals as “Parsed content records”; source-file content uses the same count label. Exploration and resource content explain that counts accumulate per file and can include CSV/XLSX format copies and document fragments. “Independent business observations” remains “Not counted / pending verification” at the resource/catalog level, which has no resource-wide verified observation count. Two files with two parsed records each therefore retain four content records, while the independent count stays unknown. Original files, hashes, versions and values remain unchanged. File names, byte hashes and matching row counts do not establish semantic equivalence; verified format-copy relationships and business deduplication require a separate governed workflow for business keys, measures, units, time, completeness and revisions.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Exploration clears the current query, selection, asset details and rendered views when a response invalidates its authorization or immutable membership, or when the advertised result deadline is reached. Background/page restoration checks the same deadline. Late failures from an older query cannot clear a newer result, and aborted requests cannot restore stale data. Query form conditions remain available for a fresh authorized query. Temporary map failures unload the canvas and offer reload without exposing upstream diagnostics.

The exploration URL retains only the owner-bound query identifier and an allowlisted view name after authorization. Submitting conditions adds a browser history entry; changing views updates that entry. Reload, Back and Forward reauthorize the manifest through the same HTTP capability, restore its conditions and view, and clear previous selections before restoration. Framework history state is preserved. Raw filters and record values are never stored in browser history state; these query links do not delegate access to another user.

Record exploration includes an expandable conditions form with up to eight typed comparisons, scalar sorting and an optional 1–32 column selection. Text identifiers retain leading zeros; blank or non-finite numeric input is rejected. Applying conditions creates a new authorized single-version/file query, clears selection, adds a history entry and opens its records view. The same predicates govern records, map tiles and record provenance. Reload restores the configuration from the authorized query; clearing it restores the selected version without record conditions. Numeric comparisons use source values without inferring or converting units.

The statistics view includes source-record aggregation after selecting a resource. Its field controls remain distinct from resource-readiness counts. Charts have an exact-value table and keyboard-operable group selection. Units remain explicit and unknown groups cannot silently become an incorrect null-only filter.

Graph exploration provides keyboard-operated file, evidence and record expansion, bounded neighbor pagination, labeled relation toggles and directed path controls scoped to the current page. Path highlighting updates G6 node/edge state without replacing its canvas. Both languages show the count grain, truncation and recovery action; switching focus clears path endpoints and cursors.

The exploration workspace saves a named private view by default, with explicit project sharing, an opaque durable link and owner revocation. Saved links restore the authorized pinned query, record/graph pagination, selected source, map layers/camera and applied aggregation. Opening a saved link always creates a newly authorized query. Export downloads one bounded JSON page with original source values, exact returned/total counts and a complete/partial label; the initial map record page does not represent all loaded tiles. Draft conditions that have not been applied are not saved.

The Data workspace navigation groups search, knowledge and specialist GIS/graph tools under the exploration workspace while preserving their existing deep links. Exploration offers these specialist routes in its toolbar. Resource tables alone may hide the provider column on narrow screens; record and aggregate tables retain every selected field and unit in an internal scroll area. Source statistics keep whole-resource readiness in a separate disclosure that mounts its chart only when open. Source-hierarchy graph layouts use vertical worker layouts below 560 px of canvas width and expose keyboard-operated zoom, fit and selected-node focus controls. Viewport changes use no animation.

On screens up to 900 px, a selected source can be inspected in a non-modal bottom drawer. Opening moves keyboard focus into its labeled region; collapse or Escape returns focus to the toggle without clearing selection. Clearing the selection returns focus to the active view tab when needed. Desktop inspection remains inline and scrollable. G6 internal canvas layers are removed from the tab order; named viewport controls and the source node list provide the keyboard interaction.

Overview task cards open the shared exploration workspace, including its map view. They describe intake and review in user-facing language. Documentation presents Data Foundation before Agent EXCON, matching the Portal.

The Portal derives its primary action from a verified session: authenticated users enter the Data workspace; anonymous users sign in. Catalog browsing uses 25-row cursor pages and a keyboard-focusable, internally scrolling table, preserving the name query on continuation and return to the first page. Source, publication, quality and security remain visible; the details explain check scope and content readiness.

Data Foundation starts with a name-based exploration entry and common tasks; normal service diagnostics are collapsed and degraded diagnostics open automatically. Agent access provides the existing setup-copy action and task-named capabilities, while ingestion keeps an explicit task-ID lookup. Quality and acceptance state is accompanied by the scope of checks; source-registration acceptance does not establish scientific validity. Resource-to-exploration links carry both resource and version identity; incomplete or invalid version links fail instead of broadening the query. Empty specialist graph/GIS pages lead into shared exploration. Runtime event payloads and error codes are not user-safe narrative contracts and are not shown as ordinary progress messages.

Knowledge graph canvases default to a ForceAtlas2 relationship layout with deterministic initial positions and 160 bounded iterations, computed in the existing cancellable worker. A keyboard-operable layout switch offers Dagre source hierarchy; only hierarchy changes direction on narrow screens. Both layouts retain bounded identities, selection, path highlighting and text alternatives. Independent resource neighborhoods are packed separately across both axes. The initial overview pages eight resources at a time; focused neighbor pages retain their own bounds. Relationship labels and semantic node colors supplement the node-kind text.

A resource opens its content workspace before collapsed governance details. A version-scoped file list, source-file download and local content tabs share the resource identity. Tables preserve scalar source values and provide readable known-field labels; document and structured views expand nested content lazily. The file preview is inert, and unsupported formats retain an explicit download action. Resource names in exploration link directly to content while a separate selection control retains query-wide analysis.

Resource content provides “Copy verification and observation deduplication”: select two fully parsed tables, explicitly map business keys, measures, units and time, and review candidate groups with source references. Show files, parsed records, candidate observations and verified observations separately. Verification updates only the batch-scoped metric after a human confirms the rules and evidence. The form must not infer mappings from filenames or erase conflicts. Retain the command key on ambiguous retries, clear displayed evidence on access denial, and preserve equivalent Chinese/English, keyboard, small-screen and light/dark states.

Available raster pixels are visible on entry, separately labeled from asset extent outlines. A keyboard-accessible opacity slider updates the existing layer without rebuilding its source or resetting the camera. Transparent areas must not be described as zero values; source units and ranges remain explicit source-reading requirements.

Business relations accept up to sixty-three additional version-specific platform source links. Pending graph preview requires explicit opt-in and retains its pending notice. Nodes preserve source identities or explicit referenced identities. Each relation exposes its source, evidence, record nature, time/location roles and applicability. Counts and continuation are bounded. Source spatial links do not imply available or verified geometry.

A copied business-relation URL restores the applied version-specific source scope, status, explicit pending preview, focus and loaded-page bound in a new tab or browser. Browser back/forward restores that same state. Links grant no access; malformed scopes and denied sources fail without silently retrying a broader query. Loading more relations retains earlier graph rows, and the interface states when the bounded loading limit is reached.

Source record and spatial links from an applied business graph carry a validated return context containing only version IDs, review state, focus and page bound. Exploration keeps this context while replacing query URLs and changing tabs, and offers a return to the previous business graph. It is a navigation origin, not a claim that every subsequent query has the same scope. Return links are generated only for internal catalog routes; they grant no access and reauthorize on reopening. Malformed return context is discarded. Sources outside the loaded relation scope retain ordinary source links. This does not establish verified geometry or cross-source spatial equivalence.

Business relations offer optional type and time filters over loaded, authorized rows. Either endpoint can match the selected kind; time-role selection is exact. Date comparisons overlap explicit source periods, preserving year/month precision as intervals. Missing, incomplete, reversed or unrecognized periods remain unknown; a point observation is used only with an explicit observation-time role. The unknown-period option applies to date filtering after type/role selection. The graph and evidence list use the same subset and show matched, loaded and total counts separately. Pagination retains nonmatching rows so clearing filters restores them. Strict URL filters survive refresh, history and source-exploration return; they neither query new data nor claim source maps/records use the same temporal conditions. Node labels include localized types without merging source identities.

Exact-record exploration links carry a bounded `recordFocus` containing only the DataItem, immutable Version and record IDs. Opening or restoring history reauthorizes the query and fetches that exact record through the existing HTTP exploration API; all three returned identities must match. Missing, malformed, denied or mismatched records fail without substituting the first row or a broader resource. Map/table selection and tab changes retain this focus and the validated business-graph return context. Applying new query conditions or selecting another resource clears stale focus. A selected record does not establish coordinate accuracy, scientific identity, or a graph-to-feature mapping; those require source-backed bindings. Saved-view selection remains governed by its existing contract and cannot be mixed with a separate record focus.

An observation node may declare `urn:wiser:record:<recordId>` as its external ID, scoped to its own source version or explicit referenced source. The Web offers exact record and spatial-content links only for a valid UUID binding on an OBSERVATION node; it never infers a record from a label or assigns geometry to a document. These links retain the applied graph return context and reauthorize/read all record identities on opening. The URI is a navigation declaration, not server attestation of scientific identity or professional approval; evidence and pending status remain visible. Ordinary external IDs are unchanged.

### Exact relation history navigation

Viewing a preceding relation stores its assertion ID in the source-bound URL. Refresh and browser history reauthorize and load that exact assertion, validating its source version and review status. Invalid, unavailable or changed targets fail without substituting another row. History selection clears graph focus and date filters, retains the authorized case scope and does not review or supersede any assertion.

Without a saved page view, an exact-record entry requests the selected record directly so off-page records are immediately visible. Mismatched response identities fail instead of substituting page one. “Browse records in this file” resumes file pagination under the same query, clears exact focus from the URL and retains the business-graph return context. Existing saved views preserve their page and cursor history.

Record inspection offers an on-demand reverse lookup of explicit record bindings through authorized, paged relation lists. It retains a valid case source scope and relationship filters, defaults to approved records without a case, and requires an explicit pending selection otherwise. Partial, empty and unavailable results are distinct; denial clears retained bindings. Opening a match focuses its source-bound business node, while the previous graph return action remains independent. Selecting a different record aborts and clears the previous lookup; matching never uses labels or invented geometry.

Business relation links optionally persist `revisionMode: "all" | "current"`; omitted means all history. Current display collapses only explicit same-DataItem, same-triple replacements in the same approved or pending review queue, after the full unfocused scope is loaded. It never chooses by timestamps, resolves competing branches, or promotes pending changes over approved knowledge. Incomplete pages, focused objects and exact history retain all loaded rows and disclose that boundary. Cyclic or invalid replacement links do not hide evidence. Type/time filters run after revision selection, and exact predecessor links still reopen immutable history. This is presentation over authorized API rows, not a new approval or authority state.

Business exploration opens a multi-source problem/evidence graph when the saved query contains business conditions. The default network includes all authorized observation detail and shows complete/scoped counts; selecting an object opens its evidence while retaining the full network. Bound-record and map links preserve the query. Authority status stays visible and source lineage remains a separate view for ordinary queries. Both locales use the shared graph canvas and design tokens.

Business problem graphs offer a two-hop neighborhood around an object category using existing edges only. This is diagram focus, not a change to the shared records/map business scope. Category and node focus persist in the query URL and restore on refresh/history navigation. Original evidence excerpts are collapsed individually; time controls disclose applied dates and expand on demand. Documents and claims reuse semantic colors alongside text types, with multiline labels in small graphs and traceable evidence details.

Map fit in a business query uses the bounds of its fully loaded rendered features, after the single display-coordinate conversion. It waits for those features, does not substitute the wider source inventory for an empty result, and allows a local extent to be inspected. A restored saved camera remains unchanged until the user requests fit.

When returning from a selected record, initialization and tab navigation retain the valid business object/category focus within the same authorized query. A different query clears that focus; duplicate or malformed values are not copied. Diagram focus does not change the data scope.

Graph labels reserve conservative screen-space boxes from current element positions after fitting, zooming and dragging. Hidden labels render no text, while edges retain a readable screen width. Overlapping labels yield to the selected object and overview labels; zooming reveals more labels. This changes neither nodes, edges, scope nor counts, and the keyboard object list and evidence remain available.

Business graph object lists distinguish identical labels using source-document captions from the already authorized relation set. The selected object links to its own exact source version, including explicit cross-source references. Missing titles retain a numbered source label; unresolved same-source duplicates retain separate object numbers. These captions do not merge identities, add relationships or widen the query.

Business exploration offers an optional path reader over the complete authorized relation set. Users select two source-qualified objects and inspect one shortest connection of at most eight edges, with original directed statements and evidence. Traversal may follow either end of a relation for reading only; it does not infer causation, approval or new edges. This local diagram inspection does not change the shared records/map query; changing endpoints clears the displayed path.

Graph initialization fits once after the first screen-space label draw, so endpoint labels remain within the canvas. Subsequent selection, zoom and label refresh preserve the user’s view; resize and explicit fit remain available. This does not change graph scope or data.

Theme changes refresh the graph’s resolved node, edge, label and label-background colors. They preserve layout, selected objects, path highlights and viewport; a redraw must not retain the initial theme’s default label color.

In optional grouped reading, a scoped query containing only observations or source relationships shows those authorized rows instead of an empty diagram. Mixed business results still collapse observation detail. Explicit object/category filters remain exact, including empty matches; this display fallback never expands the query or changes record/map scope.

Business-query record views include a source selector and searchable directory built only from explicit record bindings in the complete authorized relation result. Links retain the same query and exact DataItem/Version/record identity. Pagination must complete before showing entries; denied, inconsistent or truncated responses clear the directory. Unbound documents remain reachable through the business graph. The directory counts bound records, not independent observations, and does not expand time/review/source conditions. The file table remains a single-source view.

Within optional grouped reading, overview/all-observations mode is stored in the page URL. Reopening a saved view or remounting its query restores the selected mode; returning to overview clears the override. This is a display preference only and does not expand source, time, review or record scope. Unknown mode values fall back to overview.

When switching exploration tabs, the expanded-observation mode and valid object/category focus remain attached to the same query. A saved-view URL may transfer this display state only to the query returned by that successfully opened view. Ambiguous, unrelated or invalid identifiers never carry state into another query; this display state grants no access and does not filter records.

Evidence links in relation details, query results, and connecting paths use the evidence source version when present, retaining the owning relation context. A cross-source reference changes where the source link goes; it must not relabel the external file as belonging to the current document.

Guided reading is a presentation choice. It groups existing assertions by their source-scoped subject before paging, never merges identities or generates links. Group number and full-network mode are bounded URL state, restored on refresh and retained across exact-record/map links only within the same authorized query or the saved view that opened it. Changing object/category resets the group. Group and presentation changes use the documented native History integration to update the client immediately without repeating the full relation fetch; Next.js retains its internal history state. Out-of-range group numbers clamp to the available groups. Original evidence, query filters, immutable versions, pending status and data counts are unchanged.

### Business graph reading and presentation

Business problem graphs keep the full authorized relation set across five reading perspectives (panorama, source comparison, object neighborhood, evidence tracing and time) and planar, orthographic category-layer, or spatial-anchor presentation. Display settings and bounded camera coordinates are URL state; same-query record/map links retain them and the exact selected assertion. Source comparison places source categories and business content in separate columns; explicit one/two-step neighborhoods preserve each statement's original direction. The existing bounded path reader opens in the evidence perspective. Source/title grouping is a disclosed reading aid, with unknown classification retained; it never changes registration metadata, identity or knowledge approval. Temporal grouping uses only explicit observation/event roles on the object's own source assertions, preserving unknown and multiple periods.

The business scene uses deterministic category positions and SVG projection; ordinary provenance and optional six-assertion reading retain G6. Layer titles occupy a separate caption gutter with connector lines. Continuous pointer/pinch/keyboard zoom changes the camera without recomputing positions or dropping edges. Labels appear progressively; selected nodes/edges and their evidence remain inspectable in a keyboard-accessible list. Hover previews direct connections; selection pins evidence and dims the full-network background. Crossing-edge hit testing offers the actual candidate assertions. Evidence includes original polarity, exact source version, table/paragraph locator, limitations, review state and preceding-assertion links.

Spatial presentation uses the existing complete, bounded HTTP map query and exact data-item/version/record bindings. It keeps original point/line/area geometry, converts display coordinates through the existing map adapter, and retains unlocated knowledge separately with its original relations. Dashed connectors place document labels around a geometry's display center; neither labels nor their centers become new point features or business relations. Geometry lookup rejects changed scope, incomplete pagination and denied access. Map movement does not change the business question. Location precision and knowledge review remain separate. No source acquisition, parser rerun, migration or business-data write is performed by scene controls.

### Continuous exploration reading

Resource search matches the registered resource name or source organization, not document bodies or natural-language questions. Examples reuse current authorized names and start an explicit new resource scope. Match explanations refer to applied conditions; a displayed provider alias need not be the registered organization. Chinese composition must finish before submission, and empty results offer a fresh authorized resource query.

Expanding the workspace keeps its existing graph/map children mounted. Escape exits expansion before graph-local Escape clears selection; focus returns to the expansion control and background interaction is disabled only while expanded. Month/year controls prepare inclusive calendar bounds and require explicit application to all views. They preserve the chosen time role and unknown-period policy and never resample annual observations.

Selecting a relation explains its controlled predicate before displaying context and original evidence. Mention, attribution, citation, candidate identity and candidate receiving-water links must retain their distinct meaning and review state.

Business graph panning retains rendered nodes, edges and keyboard lists and translates the viewport. Zoom, focus and grouping still update the original members. Overlap hit testing compensates for the translated camera; performance must be measured on the same real case and browser rather than improved by dropping members.

The Data homepage lists authorized saved topics with a title filter scoped only to that bounded list (up to 100). It does not claim a complete project panorama or source-content search. Opening reuses saved-view reauthorization; refresh failure, revoked entries and late responses cannot retain a previous topic list. Identical titles include visibility and creation time, and clearing the filter restores input focus. This entry changes neither query contracts nor existing saved configurations.

Calendar stepping remembers an explicit year/month choice in bounded URL presentation state. Applying business dates carries only that choice into the new query; ordinary unrelated queries do not inherit it. Tabs and refresh retain it within the same query. Changing the step never changes the applied bounds until Apply and does not change sampling frequency. Invalid or repeated unit parameters fall back to month.

Business map views retain a visible, linked OSM/ODbL notice when displayed geometry carries that exact source declaration. Attribution is outside the zooming graph and independent of selection. This is a reviewed provider mapping, not license inference; other providers require their own declaration mapping before display.

Saved business topics restore presentation controls with their authorized query. Explicit URL overrides affect reading only. Full-screen remains a user action and is not restored automatically.

Spatial coverage separates source-scoped objects with an exact record binding from unique point, line, area and mixed geometries. Multiple graph objects bound to the same record count once as geometry; multipart geometry remains one feature. Named place/reach/basin/station objects without a binding are counted separately and retain their identity. Counts appear only after the complete authorized map result loads, never as zero while loading or denied. These counts do not measure extraction recall, distinct real-world locations or professional validation.

Panning uses a CSS transform on the retained SVG group, with an equivalent SVG attribute fallback; it does not recreate or remove members. Wheel motion and active dragging suspend incidental hover previews as geometry passes under the pointer. The pinned selection and its evidence remain intact; deliberate hover resumes after the wheel becomes idle. Verify visual hit targets after translation in both planar and layered views. These local changes do not imply that zooming or large-graph performance has met its target; record each interaction separately.

Selecting an object or relation flushes the pending wheel/pan camera into URL state before selection. Immediate selection must not discard the latest viewport or allow a delayed camera write to overwrite the selection.

Business graph pagination checks cancellation after both the response and decoded body arrive. A replaced query must not invalidate the current view or dispatch another page. An active query denied on a later page still invalidates its result and never exposes a partial graph.

Spatial reading offers a separate related-reference-extent action. It follows only loaded, authorized source-reference mentions and spatial identity-candidate links, at most two edges, and fits their existing geometries without assigning coordinates to the selected source. Rejected/correction-required links, observations, same-name guesses and unavailable geometries do not provide this action. Multiple linked areas remain visible together; a reference extent is not a precise source location or historical boundary. The action preserves selection, query, review status and geometry counts.

The official basemap releases its SDK and observers before navigation detaches its sized container. Source-document round trips must restore the selected relation and camera without map rendering errors; teardown does not alter geometry or authorization.

Evidence-path reading retains the explicitly chosen assertion IDs and versions until a new search. A changed or unavailable path clears its graph and excerpts and asks the reader to search again; it never substitutes an alternative or newly shorter route silently. Missing endpoints disable search. Evidence is read only from the current authorized relation rows, not retained in path state.

Project business graphs use the server-owned assertion membership count as their paging bound, while legacy inline-pin queries retain their existing bound. A filtered result may contain fewer relations than the fixed membership; inconsistent totals, duplicate relations and incomplete pages never produce a partial panorama. Applying a business period refines the original query ID, so later sources or assertions do not silently enter the graph, records or map.

Invalidating an exploration query also cancels any in-flight replacement and clears its busy state. A late successful response cannot restore data after expiry or authorization failure; a new explicit query is required.

Readiness statistics refine the active query membership just like business-period controls. A continuation page must contain at least one relation; empty pages with a next cursor fail visibly without following another cursor or presenting a partial graph.

Mixed review exploration labels its query as “Approved and pending”; individual relationships retain their own authority badges and pending warning. Mixed scope is not an approval action. Record-to-graph navigation preserves the same authorized query instead of switching to an approved-only list.

The normal Data Foundation homepage reuses the exploration workspace rather than a fixed demonstration view. After a successful query, its URL records the authorized query ID and selected graph view through the existing exploration route; refresh and return reopen that scope. Explicit resource searches, fixed-version links and saved topics keep their own scope. A failed project request remains a failure; it never opens a narrower topic as a substitute.

Unlocated spatial objects use a named, source-distinct searchable list with category filters and bounded pages. Paging affects only this reading list; the full query identity set remains available. Spatial lines show the current focus by default, with an explicit option for connections between currently visible objects. Full-network reading remains a separate existing presentation. The graph toolbar reuses workspace expansion without unmounting the map. Optional explanatory text uses pointer- and keyboard/touch-operable question-mark help; permission, partial-scope and review states remain visible.

Clicking a spatial point, line or area resolves all source-version-record bindings in the current authorized query. Overlapping objects require an explicit choice; repeated layer hits do not merge identities. Related sources are grouped by category and open original relation evidence. One explicitly qualified spatial reference-identity hop may reveal another source area and adjacent evidence, labeled as indirect reference. Selection preserves camera and query conditions; names never imply location bindings.

A chosen map object is retained as a bounded source-qualified navigation identity in the URL, separately from the selected evidence edge. Restoration reopens its related-source panel only after the current authorized map result supplies an exact geometry binding; unavailable targets never fall back to a same-name object. Returning to the unlocated list clears this navigation choice. The URL contains no geometry or source text and grants no access.

Thin lines and points allow a six-screen-pixel click tolerance within the already rendered, authorized geometry layers. Exact area hits remain unchanged; overlapping candidates are all offered, and unknown bindings are discarded. This interaction tolerance does not buffer geographic extents, relocate evidence, create relations or move the camera.

The business record directory uses the same server membership bound as the graph, including queries above the legacy 2,000-assertion limit. It publishes record links only after complete pagination, rejecting oversized totals, empty continuation pages, inconsistent counts and duplicate assertions. Replaced queries stop after either response or body completion; they cannot dispatch another page or invalidate the current query. Source/version/record bindings remain exact.

Exploration keeps repeated introductions, graph-scope explanations, style semantics and map-reference guidance in the existing circular question-mark help. Hover opens it; click/keyboard activation pins it and Escape dismisses it. Query counts, review/permission/failure states and source-specific evidence remain visible at their relevant surfaces. Optional help is not a substitute for a current warning, and the original explanation remains available in both locales.

In an expanded workspace, Escape on an open question-mark help closes that help first; a subsequent Escape retains the normal workspace exit behavior without clearing graph selection.

Explicitly mapped external-source details offer a year-range station-directory query, without fetching on entry. Registration, loading, empty, unconfigured, denied, expired and unavailable states remain distinct. Each bounded page replaces the previous one; failures, cancellation, source/range changes and page hiding clear retained rows. Only permitted station identifiers, years and administrative labels appear; results are neither ingested nor mapped automatically. Optional guidance uses the shared question-mark help component with keyboard/touch access. This panel does not grant provider access or establish live-provider acceptance.

### Access management presentation

The access workspace uses concise business headings, action verbs and consistent role labels. Project context, membership state, role and expiry have distinct visual hierarchy. Historical request results remain separate from current access state. Text and symbols accompany theme-aware status colors. Optional explanations are disclosed on demand; failures, access denial and important action consequences remain visible. Do not add fictitious metrics or unavailable controls to suggest product completeness.
