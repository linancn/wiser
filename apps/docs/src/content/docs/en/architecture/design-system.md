---
title: WISER Design System
description: How the existing Agent EXCON water-system console becomes the shared UI, bilingual, and theming contract for every WISER system.
docType: design-system
scope: wiser-web
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when creating or changing any WISER page, component, copy, or theme
whenToUpdate:
  - when color, typography, layout, component, interaction, language, or accessibility rules change
checkPaths:
  - apps/web/src/**
  - apps/docs/src/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: 762a2e1619555d67ebf81b468861b54dae654b39
---

## Design direction

WISER serves water-system specialists, exercise controllers, and data stewards. The interface has one job: make authority, current state, risk, evidence, and the next safe action immediately legible.

The existing Agent EXCON “water-system instrument panel” becomes the WISER design baseline. It is not a generic SaaS dashboard: abyss colors communicate authority and depth, river teal represents flowing relationships, gauge amber marks attention and human gates, and contours or flow lines appear in one signature atmospheric layer. New systems reuse this language instead of creating another product skin.

## Design tokens

The core palette comes from the current Web application:

| Name       | Base      | Use                                                |
| ---------- | --------- | -------------------------------------------------- |
| Abyss      | `#071a21` | dark canvas and high-authority regions             |
| Channel    | `#0b303a` | raised dark surfaces and channel relationships     |
| River      | `#087f8c` | primary interaction, selection, flow relationships |
| Ripple     | `#5cc7d2` | dark-theme highlight and focus                     |
| Gauge      | `#dfa33e` | attention, human gates, time-sensitive state       |
| Floodplain | `#edf5f6` | light canvas                                       |

Components consume semantic tokens only: `canvas`, `surface`, `text-*`, `accent-*`, `success-*`, `warning-*`, `danger-*`, `border-*`, and `shadow-*`. System pages never introduce another brand palette or use color as the only state signal.

Light and dark are two mappings of the same information hierarchy, not separate designs. The `wiser-theme` preference persists, first use respects the system preference, and an initializer sets `data-theme` before React hydration to avoid flashing.

## Typography and hierarchy

- Display: restrained Iowan Old Style / Source Han Serif-style faces for product theses, page titles, and major stages only.
- Body: IBM Plex Sans / Noto Sans SC / system sans for tasks, explanations, and controls.
- Utility: IBM Plex Mono / system monospace for IDs, times, versions, hashes, metrics, and protocol fields.
- Body text starts at least at 16px with approximately 1.55 line height; density never comes at the cost of readability.
- Chinese is the default language while protocol fields remain English. English pages preserve the same information, routes, actions, and states.

## Layout contract

```text
┌ WISER Portal ─ Data Foundation ─ Agent EXCON ─ Account ─ Theme ─ Language ┐
├ current-system workspace navigation (absent on Portal / Auth) ────────────┤
│                                                    │
│ page thesis + authority/status strip              │
│                                                    │
│ primary workspace                                 │
│ evidence / operations / diagnostics               │
│                                                    │
└ source, authority, version, freshness ─────────────┘
```

- Information hierarchy is `Portal → business system → system workspace → domain object`; object-local tabs never become platform navigation.
- The WISER logo returns to the locale Portal. Portal is not a third system, and Data Foundation precedes Agent EXCON.
- The global shell, system switcher, Project context, theme, and language remain in the same location everywhere. System workspace navigation appears only after entering that system.
- A page identifies the user's object and its authoritative state before metrics or technical detail.
- Lists, catalogs, and runtime views share card, table, filter, pagination, empty, and failure primitives.
- Technical diagnostics may be denser but never dominate the first visual layer of management and business pages.
- Maximum desktop width, a 390px viewport, keyboard navigation, and reduced motion are required acceptance surfaces.

## State and components

Shared components include AppShell, SystemSwitcher, ProjectSwitcher, PageHeader, AuthorityStrip, StatusBadge, MetricCell, DataTable, FilterBar, EmptyState, FailureState, OperationTimeline, EvidenceLink, VersionPicker, ThemeToggle, and LocaleSwitcher.

- Success, warning, failure, waiting, and unknown states use text and shape as well as color.
- Buttons use action verbs, and an action keeps the same name from button to toast.
- Empty states explain the available action; failures state what happened, its impact, and recovery.
- Every visible string exists in both zh-CN and en dictionaries. Components do not scatter hard-coded bilingual ternaries.

## Product-content boundary

- Ordinary pages explain user goal, current state, impact, and next action before implementation architecture.
- Introductions, empty states, and failures do not expose environment variables, internal URLs, HTTP status, raw error codes, DTO/DAL, databases, workers, or operator recovery commands.
- Trace, Span, CRS, version, and hash terminology appears only when the specialist task requires it.
- See [Product interface and content design](/en/development/product-experience/) for naming, public entry, copy, and new-system contracts.

## System adaptation

- Agent EXCON's signature objects are Runs, Receipts, Barriers, and collaboration flows.
- Data Foundation's signature objects are DataItems, Versions, Ingestions, Operations, Lineage, and map layers.
- Both share the shell, tokens, and components without erasing domain vocabulary: one visual state may represent different domain objects.
- Maps, traces, and lineage graphs may use specialized canvases, but their themes, focus, panels, legends, and state semantics still come from the shared system.

The Data map implements this contract through accessible controls rather than canvas color alone. DataItem version links use `aria-current`; the map form pins bbox, immutable Version, and EPSG:4326/4490 source CRS. PostGIS authority, STAC extent, vector MVT, and raster layers each have a text-labeled checkbox, with unavailable layers disabled. Controls continuously show selectedVersion and display-coordinate conversion with position pending independent verification; layer colors read current theme tokens, so light/dark changes never alter authority hierarchy. Browser tiles use same-origin Web paths, keeping server identity and internal GIS origins out of the UI.

For raster-only specialist maps, the requested area controls the initial viewport when no verified feature or STAC extent is present. Existing unavailable-layer indicators remain unchanged; a camera location is not presented as a newly verified spatial feature.

## Acceptance

Every page passes Chinese and English, light and dark, desktop and 390px, keyboard focus, no browser errors, no horizontal overflow, and reduced-motion checks. Screenshot review compares EXCON and Data Foundation together; any local UI that looks like a second product is pulled back into shared tokens or components.

### Data exploration workspaces

Data workspaces use compact headings and bounded grid children so real long excerpts and identifiers wrap within narrow screens. Graph canvases use shared semantic colors, a readable text alternative and a version-aware selection inspector. Canvas selection has an outline as well as color, and node selection is available through keyboard-operated buttons.

The `/[locale]/data-foundation/explore` workspace shares the strict exploration contracts with the API. A compact query bar, resource table and selection inspector keep the result area near the top of the viewport. Server rendering starts or resumes an authorized result set; subsequent queries pass through the session-verified Next.js endpoint `/api/data-foundation/explore`. Filters start a new version manifest; paging keeps the same `queryId`. Keyboard-operable resource names expose exact versions, readiness and source limitations. Unknown analytical counts remain explicit instead of becoming zero.

The exploration workspace shares a query bar and a single Inspector across resource, record and map tabs. Tabs support arrow/Home/End keys. Selection uses the same record identity across views, clears on a new result set, and ignores stale query events. Map layers use semantic theme colors; tables scroll inside their panel.

The shared Inspector also accepts typed graph nodes. The G6 provenance view uses a bounded hierarchical layout and keyboard-operable node list; a focused record retains its identity when switching to the map or table. Node inspection keeps the graph entry focus stable, while an explicit overview action returns to the query-wide graph.

Exploration keeps provider, registration-type and readiness controls in an expandable filter area. A compact coverage disclosure summarizes the whole result set, with text labels for content and spatial states. Completed assessment is distinct from indexed content; the summary never substitutes the current page size for the result total.

The exploration statistics tab uses [Apache ECharts 6.1.0](https://github.com/apache/echarts/releases/tag/6.1.0), loaded on demand with the SVG renderer and only the required chart components. It charts server-computed readiness counts for the full authorized query. Selecting a bar or its keyboard-accessible text equivalent applies the same readiness filter to resource exploration. Chart colors follow semantic tokens; resize/theme observers and the chart instance are disposed on unmount. Resource counts must not be presented as record counts or scientific observations.

Exploration 1.5 adds optional map-wide `spatial.bounds` (WGS84 or null for an empty result) and `mercatorFeatureCount`, computed over the same authorized record set independently of pagination. The browser requests one initial record and this summary, fits the full result bounds, and loads same-origin query MVT by viewport. Clicking an individual feature performs a 1.4 exact-record lookup; a cluster click zooms in. The map distinguishes viewport feature/cluster counts from map-ready record totals. Tile-boundary ownership is corrected by append-only migration `0015_exploration_tile_boundaries.sql`, so points at tile seams contribute once. The 1.4 contract remains archived.

Exploration clears the current query, selection, asset details and rendered views when a response invalidates its authorization or immutable membership, or when the advertised result deadline is reached. Background/page restoration checks the same deadline. Late failures from an older query cannot clear a newer result, and aborted requests cannot restore stale data. Query form conditions remain available for a fresh authorized query. Temporary map failures unload the canvas and offer reload without exposing upstream diagnostics.

Record exploration includes an expandable conditions form with up to eight typed comparisons, scalar sorting and an optional 1–32 column selection. Text identifiers retain leading zeros; blank or non-finite numeric input is rejected. Applying conditions creates a new authorized single-version/file query, clears selection, adds a history entry and opens its records view. The same predicates govern records, map tiles and record provenance. Reload restores the configuration from the authorized query; clearing it restores the selected version without record conditions. Numeric comparisons use source values without inferring or converting units.

The statistics view includes source-record aggregation after selecting a resource. Its field controls remain distinct from resource-readiness counts. Charts have an exact-value table and keyboard-operable group selection. Units remain explicit and unknown groups cannot silently become an incorrect null-only filter.

Graph exploration provides keyboard-operated file, evidence and record expansion, bounded neighbor pagination, labeled relation toggles and directed path controls scoped to the current page. Path highlighting updates G6 node/edge state without replacing its canvas. Both languages show the count grain, truncation and recovery action; switching focus clears path endpoints and cursors.

The exploration workspace saves a named private view by default, with explicit project sharing, an opaque durable link and owner revocation. Saved links restore the authorized pinned query, record/graph pagination, selected source, map layers/camera and applied aggregation. Opening a saved link always creates a newly authorized query. Export downloads one bounded JSON page with original source values, exact returned/total counts and a complete/partial label; the initial map record page does not represent all loaded tiles. Draft conditions that have not been applied are not saved.

The Data workspace navigation groups search, knowledge and specialist GIS/graph tools under the exploration workspace while preserving their existing deep links. Exploration offers these specialist routes in its toolbar. Resource tables alone may hide the provider column on narrow screens; record and aggregate tables retain every selected field and unit in an internal scroll area. Source statistics keep whole-resource readiness in a separate disclosure that mounts its chart only when open. Source-hierarchy graph layouts use vertical worker layouts below 560 px of canvas width and expose keyboard-operated zoom, fit and selected-node focus controls. Viewport changes use no animation.

On screens up to 900 px, a selected source can be inspected in a non-modal bottom drawer. Opening moves keyboard focus into its labeled region; collapse or Escape returns focus to the toggle without clearing selection. Clearing the selection returns focus to the active view tab when needed. Desktop inspection remains inline and scrollable. G6 internal canvas layers are removed from the tab order; named viewport controls and the source node list provide the keyboard interaction.

Overview task cards open the shared exploration workspace, including its map view. They describe intake and review in user-facing language. Documentation presents Data Foundation before Agent EXCON, matching the Portal.

Graph selection and path updates send only changed node/edge states to G6. Unchanged elements are not redrawn through a full-state submission; removing a path clears its previous highlights while preserving selection. Large graphs still incur bounded initial rendering work; layout computation remains in a cancellable worker.

The Portal derives its primary action from a verified session: authenticated users enter the Data workspace; anonymous users sign in. Catalog browsing uses 25-row cursor pages and a keyboard-focusable, internally scrolling table, preserving the name query on continuation and return to the first page. Source, publication, quality and security remain visible; the details explain check scope and content readiness.

Data discovery and review pages use a compact shared heading and project-scope label. Catalog and quality tables keep status labels on one line, align text to the reading direction and scroll within a keyboard-focusable region. Quality review uses 25-row cursor pages. Search and knowledge results use 10-row cursor pages with a bounded result region, named version links, short excerpts and expandable source conditions, original excerpts and technical evidence. Registration manifests are labeled as source registration rather than rendered as article prose. The same disclosure component keeps protocol details secondary across versions, intake and agent access.

Knowledge graph canvases default to a ForceAtlas2 relationship layout with deterministic initial positions and 160 bounded iterations, computed in the existing cancellable worker. A keyboard-operable layout switch offers Dagre source hierarchy; only hierarchy changes direction on narrow screens. Both layouts retain bounded identities, selection, path highlighting and text alternatives. Independent resource neighborhoods are packed separately across both axes. The initial overview pages eight resources at a time; focused neighbor pages retain their own bounds. Relationship labels and semantic node colors supplement the node-kind text.

A resource opens its content workspace before collapsed governance details. A version-scoped file list, source-file download and local content tabs share the resource identity. Tables preserve scalar source values and provide readable known-field labels; document and structured views expand nested content lazily. The file preview is inert, and unsupported formats retain an explicit download action. Resource names in exploration link directly to content while a separate selection control retains query-wide analysis.

Available raster pixels are visible on entry, separately labeled from asset extent outlines. A keyboard-accessible opacity slider updates the existing layer without rebuilding its source or resetting the camera. Transparent areas must not be described as zero values; source units and ranges remain explicit source-reading requirements.

Business relations accept up to sixty-three additional version-specific platform source links. Pending graph preview requires explicit opt-in and retains its pending notice. Nodes preserve source identities or explicit referenced identities. Each relation exposes its source, evidence, record nature, time/location roles and applicability. Counts and continuation are bounded. Source spatial links do not imply available or verified geometry.

Business-relation deep links open the relation disclosure and restore its source scope, review status and selected entity. Accumulated graph counts distinguish loaded rows from the authorized total and expose a bounded continuation limit; the canvas fit control changes only the viewport. Pending preview remains visibly pending after restoration.

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

Graph labels reserve conservative screen-space boxes from current element positions after fitting, zooming and dragging. Hidden labels render no text, while edges retain a readable screen width. Overlapping labels yield to the selected object and overview labels; zooming reveals more labels. This changes neither nodes, edges, scope nor counts, and the keyboard object list and evidence remain available.

Business graph object lists distinguish identical labels using source-document captions from the already authorized relation set. The selected object links to its own exact source version, including explicit cross-source references. Missing titles retain a numbered source label; unresolved same-source duplicates retain separate object numbers. These captions do not merge identities, add relationships or widen the query.

Business exploration offers an optional path reader over the complete authorized relation set. Users select two source-qualified objects and inspect one shortest connection of at most eight edges, with original directed statements and evidence. Traversal may follow either end of a relation for reading only; it does not infer causation, approval or new edges. This local diagram inspection does not change the shared records/map query; changing endpoints clears the displayed path.

Evidence links in relation details, query results, and connecting paths use the evidence source version when present, retaining the owning relation context. A cross-source reference changes where the source link goes; it must not relabel the external file as belonging to the current document.

The exploration position note occupies normal flow below the map canvas. It does not overlay the layer legend or failure recovery controls. Bilingual narrow/wide layout checks cover expanded legends and retry states separately from map correctness.

Exploration map actions and viewport counts occupy normal flow above the canvas. Basemap loading and failure notices remain inside the canvas, leaving Fit bounds and area filtering clickable while preserving basemap retry.

Nested source fields choose label/value columns from the available cell width. Narrow cells stack the label above its value even on desktop, so opening table evidence does not reduce short source numbers to one character per line. Values and evidence selection remain unchanged; the surrounding table owns scrolling.

Optional guided reading shows six exact business relations per group. Rounded, text-bearing nodes use a layered layout with space reserved for their full card footprint; labels stay horizontal. Repeated labels at shared endpoints are available through an explicit control or object selection. Isolated pairs retain their relationship label. The full network remains available, and all authorized objects remain in the keyboard-accessible lookup. Reading controls occupy their own toolbar instead of covering the canvas. The graph and evidence list show the same group, while the current-scope and query counts stay separate.

### Business graph reading and presentation

Business problem graphs keep the full authorized relation set across five reading perspectives (panorama, source comparison, object neighborhood, evidence tracing and time) and planar, orthographic category-layer, or spatial-anchor presentation. Display settings and bounded camera coordinates are URL state; same-query record/map links retain them and the exact selected assertion. Source comparison places source categories and business content in separate columns; explicit one/two-step neighborhoods preserve each statement's original direction. The existing bounded path reader opens in the evidence perspective. Source/title grouping is a disclosed reading aid, with unknown classification retained; it never changes registration metadata, identity or knowledge approval. Temporal grouping uses only explicit observation/event roles on the object's own source assertions, preserving unknown and multiple periods.

The business scene uses deterministic category positions and SVG projection; ordinary provenance and optional six-assertion reading retain G6. Layer titles occupy a separate caption gutter with connector lines. Continuous pointer/pinch/keyboard zoom changes the camera without recomputing positions or dropping edges. Labels appear progressively; selected nodes/edges and their evidence remain inspectable in a keyboard-accessible list. Hover previews direct connections; selection pins evidence and dims the full-network background. Crossing-edge hit testing offers the actual candidate assertions. Evidence includes original polarity, exact source version, table/paragraph locator, limitations, review state and preceding-assertion links.

Spatial presentation uses the existing complete, bounded HTTP map query and exact data-item/version/record bindings. It keeps original point/line/area geometry, converts display coordinates through the existing map adapter, and retains unlocated knowledge separately with its original relations. Dashed connectors place document labels around a geometry's display center; neither labels nor their centers become new point features or business relations. Geometry lookup rejects changed scope, incomplete pagination and denied access. Map movement does not change the business question. Location precision and knowledge review remain separate. No source acquisition, parser rerun, migration or business-data write is performed by scene controls.

Workspace expansion uses the existing semantic surface, an accessible named dialog and a sticky exit control. The same children retain reading state. Expansion traps keyboard focus and restores it on exit; it does not change query membership. Search explanations and examples remain secondary to results and wrap within narrow viewports.

Node color and shape encode type families, edge colors encode predicate families, and dashes indicate pending review. Identity matches have no directional arrow. Overview/evidence/smooth styles change labels only and retain all members, restoring through the existing URL view state.

Group captions avoid each other within the available canvas and use neutral, arrowless leaders to their original groups. When space is insufficient, only captions are omitted and the displayed caption count is disclosed; complete groups and members remain accessible through keyboard lists. Caption placement never changes business objects, relationships or spatial coordinates.

Spatial anchors retain the same node families, shapes, predicate colors, pending dashes and arrowless identity matches as the planar graph. Unlocated members use deterministic rows within each source-qualified group, allocating room by member count rather than compressing every group into a fixed-radius cluster. All members and relationships remain present; this screen-space arrangement creates no geographic position or identity.

Locating a spatial graph object fits its full line, area or multi-part extent within the unobscured map region. Only zero-extent geometry uses point focus. Display centers remain label connectors; named places without an exact permitted geometry binding retain their existing relations without invented coordinates.

Spatial coverage separates source-scoped objects with an exact record binding from unique point, line, area and mixed geometries. Multiple graph objects bound to the same record count once as geometry; multipart geometry remains one feature. Named place/reach/basin/station objects without a binding are counted separately and retain their identity. Counts appear only after the complete authorized map result loads, never as zero while loading or denied. These counts do not measure extraction recall, distinct real-world locations or professional validation.

Panning uses a CSS transform on the retained SVG group, with an equivalent SVG attribute fallback; it does not recreate or remove members. Wheel motion and active dragging suspend incidental hover previews as geometry passes under the pointer. The pinned selection and its evidence remain intact; deliberate hover resumes after the wheel becomes idle. Verify visual hit targets after translation in both planar and layered views. These local changes do not imply that zooming or large-graph performance has met its target; record each interaction separately.

Selecting an object or relation flushes the pending wheel/pan camera into URL state before selection. Immediate selection must not discard the latest viewport or allow a delayed camera write to overwrite the selection.

Business graph pagination checks cancellation after both the response and decoded body arrive. A replaced query must not invalidate the current view or dispatch another page. An active query denied on a later page still invalidates its result and never exposes a partial graph.

The official basemap releases its SDK and observers before navigation detaches its sized container. Source-document round trips must restore the selected relation and camera without map rendering errors; teardown does not alter geometry or authorization.

Project business graphs use the server-owned assertion membership count as their paging bound, while legacy inline-pin queries retain their existing bound. A filtered result may contain fewer relations than the fixed membership; inconsistent totals, duplicate relations and incomplete pages never produce a partial panorama. Applying a business period refines the original query ID, so later sources or assertions do not silently enter the graph, records or map.

Invalidating an exploration query also cancels any in-flight replacement and clears its busy state. A late successful response cannot restore data after expiry or authorization failure; a new explicit query is required.

Mixed review exploration labels its query as “Approved and pending”; individual relationships retain their own authority badges and pending warning. Mixed scope is not an approval action. Record-to-graph navigation preserves the same authorized query instead of switching to an approved-only list.

The normal Data Foundation entry and unfiltered exploration entry open the authorized project business graph. A compact project title distinguishes it from a saved topic or resource search; approved and pending assertions keep their own labels. Saved topics load only when their disclosure is opened. Operational status remains secondary and cannot replace the graph with example data.

Clicking a spatial point, line or area resolves all source-version-record bindings in the current authorized query. Overlapping objects require an explicit choice; repeated layer hits do not merge identities. Related sources are grouped by category and open original relation evidence. One explicitly qualified spatial reference-identity hop may reveal another source area and adjacent evidence, labeled as indirect reference. Selection preserves camera and query conditions; names never imply location bindings.

A chosen map object is retained as a bounded source-qualified navigation identity in the URL, separately from the selected evidence edge. Restoration reopens its related-source panel only after the current authorized map result supplies an exact geometry binding; unavailable targets never fall back to a same-name object. Returning to the unlocated list clears this navigation choice. The URL contains no geometry or source text and grants no access.

Thin lines and points allow a six-screen-pixel click tolerance within the already rendered, authorized geometry layers. Exact area hits remain unchanged; overlapping candidates are all offered, and unknown bindings are discarded. This interaction tolerance does not buffer geographic extents, relocate evidence, create relations or move the camera.

The business record directory uses the same server membership bound as the graph, including queries above the legacy 2,000-assertion limit. It publishes record links only after complete pagination, rejecting oversized totals, empty continuation pages, inconsistent counts and duplicate assertions. Replaced queries stop after either response or body completion; they cannot dispatch another page or invalidate the current query. Source/version/record bindings remain exact.

Exploration keeps repeated introductions, graph-scope explanations, style semantics and map-reference guidance in the existing circular question-mark help. Hover opens it; click/keyboard activation pins it and Escape dismisses it. Query counts, review/permission/failure states and source-specific evidence remain visible at their relevant surfaces. Optional help is not a substitute for a current warning, and the original explanation remains available in both locales.

In an expanded workspace, Escape on an open question-mark help closes that help first; a subsequent Escape retains the normal workspace exit behavior without clearing graph selection.

Question-mark triggers retain their circular shape against workspace button styles, use larger targets for coarse pointers, and clamp open explanations to the viewport on resize.
