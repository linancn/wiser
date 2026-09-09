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
lastReviewedAt: 2026-09-09
lastReviewedCommit: db2129ea821ba973e2f5d6602a8276de6911ded3
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
| Agent EXCON scenarios      | `/[locale]/scenarios`, `/[locale]/scenarios/[scenarioId]`                                                        |
| Agent EXCON runs           | `/[locale]/runs`, `/[locale]/runs/[runId]`, plus `collaboration`, `diagnostics`, `trace`, and `replay` subroutes |
| Data Foundation overview   | `/[locale]/data-foundation`                                                                                      |
| Data Foundation workspaces | `catalog`, `ingestions`, `quality`, `search`, `knowledge`, `graph`, `geo`, `map`, and `capabilities`             |
| Data Foundation detail     | `catalog/[dataItemId]`, `ingestions/[ingestionId]`, `operations/[operationId]`, and `lineage/[dataItemId]`       |

In Supabase mode, Portal, sign-in, and Auth transport routes are public. Other localized product routes require verified authenticated claims in Proxy; anonymous requests retain their target and redirect to locale sign-in. `WISER_AUTH_MODE=off` remains a local reference-preview mode only.

Pages are Server Components by default. Add a Client Component only for browser interaction, browser APIs, or local state. Do not move data access and identity logic into the browser merely because a parent view contains an interaction.

Portal and Docs expose a localized Agent setup copy action backed by the server-configured public `WISER_AGENT_SETUP_URL`. Clipboard denial reveals selectable instructions; success reports only that copying completed. No credential or project data is attached to the prompt. The [Agent setup protocol](/en/protocols/agent-setup/) defines release verification and the separate connection check. Production Docs need the intended URL at build time because their pages are prerendered.

## Agent EXCON read models

Agent EXCON pages support two explicit data modes:

| Mode        | Purpose                                                                      | Failure behavior                                                                |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `reference` | Default deterministic design reference, build, and end-to-end test data      | The page is clearly labeled as a design preview                                 |
| `live`      | Server Components read operator projections from the Agent EXCON v2 HTTP API | An actionable unavailable/error state appears; reference data is never mixed in |

The server-side `AGENT_EXCON_WEB_DATA_MODE` selects the mode. `live` requests use `cache: no-store`, and the API origin and verified current user access token remain server-only. In Supabase mode, EXCON and Data use the same server-only session verifier; a static `WISER_WEB_OPERATOR_TOKEN` is limited to local Auth-off development. When a current DTO does not provide the required fact, show a coverage gap or empty state. Never fill it from the reference sample or infer Agent, span, replay-perspective, or verdict facts in the frontend.

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

The `/[locale]/data-foundation/explore` workspace shares the strict exploration contracts with the API. A compact query bar, resource table and selection inspector keep the result area near the top of the viewport. Server rendering starts or resumes an authorized result set; subsequent queries pass through the session-verified Next.js endpoint `/api/data-foundation/explore`. Filters start a new version manifest; paging keeps the same `queryId`. Keyboard-operable resource names expose exact versions, readiness and source limitations. Unknown analytical counts remain explicit instead of becoming zero.

The explorer uses MapLibre GL JS 6.8.0 with react-map-gl 8.1.3, loaded only when opening the map. `apps/web/scripts/prepare-maplibre.mjs` runs before dev/build and copies the exact matching worker and shared module into a versioned same-origin public directory. Generated vendor files are ignored by Git. A pinned public-domain Natural Earth 1:110m land layer supplies a small self-hosted overview basemap; `public/basemap/source.json` records its source commit and SHA-256. This overview layer does not imply street-level detail.

The exploration statistics tab uses [Apache ECharts 6.1.0](https://github.com/apache/echarts/releases/tag/6.1.0), loaded on demand with the SVG renderer and only the required chart components. It charts server-computed readiness counts for the full authorized query. Selecting a bar or its keyboard-accessible text equivalent applies the same readiness filter to resource exploration. Chart colors follow semantic tokens; resize/theme observers and the chart instance are disposed on unmount. Resource counts must not be presented as record counts or scientific observations.

Exploration clears the current query, selection, asset details and rendered views when a response invalidates its authorization or immutable membership, or when the advertised result deadline is reached. Background/page restoration checks the same deadline. Late failures from an older query cannot clear a newer result, and aborted requests cannot restore stale data. Query form conditions remain available for a fresh authorized query. Temporary map failures unload the canvas and offer reload without exposing upstream diagnostics.

Record exploration includes an expandable conditions form with up to eight typed comparisons, scalar sorting and an optional 1–32 column selection. Text identifiers retain leading zeros; blank or non-finite numeric input is rejected. Applying conditions creates a new authorized single-version/file query, clears selection, adds a history entry and opens its records view. The same predicates govern records, map tiles and record provenance. Reload restores the configuration from the authorized query; clearing it restores the selected version without record conditions. Numeric comparisons use source values without inferring or converting units.

The statistics view includes source-record aggregation after selecting a resource. Its field controls remain distinct from resource-readiness counts. Charts have an exact-value table and keyboard-operable group selection. Units remain explicit and unknown groups cannot silently become an incorrect null-only filter.

Exploration 1.8 adds typed time predicates and sorting, and hour/day/month/year aggregation. Source formats are `iso-offset`, `dmy-local` or `ymd-local`; `utcOffsetMinutes` is an explicit fixed offset from −840 to 840, not an inferred time zone or daylight-saving rule. ISO source values retain their own offset. Naive source times require the configured offset, which also defines calendar buckets. Invalid dates become ungroupable rather than normalized. Boundaries are UTC strings with up to six fractional digits, and ranges use inclusive `gte` plus exclusive `lt`. Source strings remain unchanged. The browser supports calendar lines, complete-bucket brushing and equivalent keyboard range controls; unit series remain separate. All views and MVT use the same conditions. The 1.7 discovery schemas remain immutable.

Exploration 1.10 adds immutable `spec.spatialBounds` in WGS84 west/south/east/north order. It uses verified geometry intersections across records, aggregates, graph record lookups and query MVT before clustering. Resource and provenance overviews contain matching versions; source-readiness metrics retain their documented indexed-content meaning. The manifest keeps the underlying authorized pins so clearing or changing the area via `baseQueryId` does not refresh analyses or lose the original population. Every pinned member is reauthorized even when outside the current area. The map offers point/line/polygon visibility, a legend, local-font cluster counts and viewport filtering; layer visibility is presentation only and never changes query authorization or counts. Unverified coordinates are excluded explicitly. The 1.9 discovery schemas remain immutable.

Graph exploration provides keyboard-operated file, evidence and record expansion, bounded neighbor pagination, labeled relation toggles and directed path controls scoped to the current page. Path highlighting updates G6 node/edge state without replacing its canvas. Both languages show the count grain, truncation and recovery action; switching focus clears path endpoints and cursors.

The Data workspace navigation groups search, knowledge and specialist GIS/graph tools under the exploration workspace while preserving their existing deep links. Exploration offers these specialist routes in its toolbar. Resource tables alone may hide the provider column on narrow screens; record and aggregate tables retain every selected field and unit in an internal scroll area. Source statistics keep whole-resource readiness in a separate disclosure that mounts its chart only when open. Graph canvases use vertical worker layouts below 560 px of canvas width and expose keyboard-operated zoom, fit and selected-node focus controls. Viewport changes use no animation.

On screens up to 900 px, a selected source can be inspected in a non-modal bottom drawer. Opening moves keyboard focus into its labeled region; collapse or Escape returns focus to the toggle without clearing selection. Clearing the selection returns focus to the active view tab when needed. Desktop inspection remains inline and scrollable. G6 internal canvas layers are removed from the tab order; named viewport controls and the source node list provide the keyboard interaction.
