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
lastReviewedAt: 2026-09-08
lastReviewedCommit: f89e182d9cfae963bb6fe4be3a8c89863b4b821a
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

The Data map implements this contract through accessible controls rather than canvas color alone. DataItem version links use `aria-current`; the map form pins bbox, immutable Version, and EPSG:4326/4490 source CRS. PostGIS authority, STAC extent, vector MVT, and raster layers each have a text-labeled checkbox, with unavailable layers disabled. Controls continuously show selectedVersion and `source CRS → EPSG:3857`; layer colors read current theme tokens, so light/dark changes never alter authority hierarchy. Browser tiles use same-origin Web paths, keeping server identity and internal GIS origins out of the UI.

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
