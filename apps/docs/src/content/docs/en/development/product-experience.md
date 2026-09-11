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
lastReviewedAt: 2026-09-11
lastReviewedCommit: b0299f324b18879dcf076cfde9521e077ee7bac5
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
