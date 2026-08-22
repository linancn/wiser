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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
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
