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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
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
