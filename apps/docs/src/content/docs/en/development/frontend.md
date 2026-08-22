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
lastReviewedAt: 2026-08-22
lastReviewedCommit: c9b9047b81f84ad7a704f9d0806526a43a90d7f1
---

## Two frontend applications

| Application | Local entrypoint        | Responsibility                                                                   | Code entrypoint                                     |
| ----------- | ----------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------- |
| `apps/web`  | `http://127.0.0.1:3000` | WISER product UI: unified sign-in, Agent EXCON, and Data Foundation workspaces   | `src/app/[locale]`, `src/components`, and `src/lib` |
| `apps/docs` | `http://127.0.0.1:4321` | WISER Fumadocs site: architecture, protocols, runbooks, and development guidance | `src/app` and `src/content/docs/{zh-CN,en}`         |

The applications share the WISER visual language, Chinese-default policy, and light/dark capability, but they do not share runtime state. Product functionality belongs in `apps/web`; developer guidance belongs in `apps/docs`. Do not turn Docs into another product console or embed long development guides in product pages.

See the [local development environment](/en/development/local-environment/) for runtime modes and ports. See the [WISER Design System](/en/architecture/design-system/) for visual tokens, component semantics, and accessibility contracts.

## Locale and theme contract

### Product Web

- Supported locales are `zh-CN` and `en`; `/` redirects to `/zh-CN/scenarios`.
- Every product page lives under `src/app/[locale]`, so Chinese and English naturally use the same locale-free slug. For example, `/zh-CN/runs` corresponds to `/en/runs`.
- Visible copy belongs in the two dictionaries in `src/lib/i18n.ts`. Chinese is the default expression; protocol and domain identifiers such as HTTP, MCP, Run, and DataItem may remain English.
- `AppShell` owns system switching, primary navigation, current identity, theme, and locale switching. New pages continue to use that shell instead of introducing parallel global navigation.
- Themes consume semantic tokens. `wiser-theme` persists the choice, first use respects the system preference, and `data-theme` is set before hydration. Light and dark preserve the same hierarchy, state meaning, and actions.

### Documentation site

- Chinese content lives in `src/content/docs/zh-CN` and its default routes have no locale prefix. English content lives in `src/content/docs/en` and routes start with `/en`.
- A translation pair uses the same relative path and slug and appears in the same position in both `meta.json` files.
- The Fumadocs provider supplies Chinese/English, light/dark/system themes, and static search. New content must remain readable in both languages and both color themes.

## Product Web routes

| Workspace                  | Routes                                                                                                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Unified identity           | `/[locale]/login`, `/[locale]/auth/login`, `/[locale]/auth/callback`, `/[locale]/auth/sign-out`                  |
| Agent EXCON scenarios      | `/[locale]/scenarios`, `/[locale]/scenarios/[scenarioId]`                                                        |
| Agent EXCON runs           | `/[locale]/runs`, `/[locale]/runs/[runId]`, plus `collaboration`, `diagnostics`, `trace`, and `replay` subroutes |
| Data Foundation overview   | `/[locale]/data-foundation`                                                                                      |
| Data Foundation workspaces | `catalog`, `ingestions`, `quality`, `search`, `knowledge`, `graph`, `geo`, `map`, and `capabilities`             |
| Data Foundation detail     | `catalog/[dataItemId]`, `ingestions/[ingestionId]`, `operations/[operationId]`, and `lineage/[dataItemId]`       |

Pages are Server Components by default. Add a Client Component only for browser interaction, browser APIs, or local state. Do not move data access and identity logic into the browser merely because a parent view contains an interaction.

## Agent EXCON read models

Agent EXCON pages support two explicit data modes:

| Mode        | Purpose                                                                      | Failure behavior                                                                |
| ----------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `reference` | Default deterministic design reference, build, and end-to-end test data      | The page is clearly labeled as a design preview                                 |
| `live`      | Server Components read operator projections from the Agent EXCON v2 HTTP API | An actionable unavailable/error state appears; reference data is never mixed in |

The server-side `AGENT_EXCON_WEB_DATA_MODE` selects the mode. `live` requests use `cache: no-store`, and the API origin and `WISER_WEB_OPERATOR_TOKEN` remain server-only. When a current DTO does not provide the required fact, show a coverage gap or empty state. Never fill it from the reference sample or infer Agent, span, replay-perspective, or verdict facts in the frontend.

## Data Foundation data and identity

Data Foundation has no reference mode. Every page reads the live API through the server-only DAL in `src/lib/data-foundation-dal.server.ts`. Missing configuration, authentication failure, denied authorization, contract-invalid responses, and unavailable upstreams converge to classified failure states instead of fabricated data.

The access sequence is:

1. The Next.js proxy and Server Components use the Supabase SSR cookie session.
2. The server verifies user, session, role, and expiry through `getClaims()`, then reads the access token through `getSession()` and confirms that both refer to the same session.
3. The DAL forwards the Bearer token plus tenant, project, and purpose context to the WISER API. Requests disable caching and bound timeout, media type, and response size.
4. The browser receives only the Supabase URL and publishable key. Database credentials, service-role keys, internal API origins, operator tokens, and raw upstream errors never enter Client Components or serialized props.

Map tiles also use a same-origin Web route whose server proxy adds identity and scope. Never put an internal GIS origin or access token in a map URL.

## Implement a new page

1. Identify whether the page belongs to Platform, Agent EXCON, or Data Foundation, then reuse the existing system navigation and domain vocabulary.
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

The repository does not currently have a full-stack Playwright command that issues an EXCON operator credential. To verify EXCON live, obtain a real `WISER_WEB_OPERATOR_TOKEN` through a trusted operator flow, then run an isolated Web instance or dedicated test with `AGENT_EXCON_WEB_DATA_MODE=live` and server-side `AGENT_EXCON_API_INTERNAL_URL`. Without that step, report the result as reference-UI verification rather than live/Auth E2E.

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
