---
title: WISER repository agent guide
docType: contract
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - before making any repository change
  - when selecting verification and documentation workflows
whenToUpdate:
  - when repository boundaries or delivery rules change
  - when required verification or governance commands change
checkPaths:
  - AGENTS.md
  - .docpact/config.yaml
  - .github/workflows/**
  - package.json
lastReviewedAt: 2026-08-22
lastReviewedCommit: 9b08f11b30895f78063d42881a16e62bb3ffc054
---

# WISER repository instructions

## Delivery discipline

- Work in small Red → Green → Refactor loops. Confirm every new test fails for the expected reason before implementation.
- Red commits are explicit recovery points. End every milestone on a verified Green commit and preserve the small commit history unless the user asks to rewrite it.
- Keep every system `core` pure and deterministic. Core must not import database, HTTP, framework, clock, random, filesystem, or AI provider code.
- Dependency direction is `platform contracts <- system contracts <- core <- application <- infra/apps`. A system may consume another system only through public contracts or HTTP, never through its core or infra.
- MCP, Skills, and browsers call the HTTP API and never read a database or projection store directly.
- AI never produces deterministic scores or verdicts. Tests and CI use the fake provider; trusted host-only development may use the local Codex CLI provider.
- Every product surface follows the WISER Design System established by Agent EXCON, including shared semantic tokens, components, light/dark themes, keyboard access, and responsive behavior.
- Every visible UI message belongs in both locale dictionaries. Chinese (`zh-CN`) is the default, and English preserves the same routes, states, and actions.
- `apps/docs` is the human-facing source of truth for current architecture, protocols, and development workflows. Root READMEs orient first-time readers; component READMEs stay scoped to one process. Superseded plans and milestone narratives belong in Git history or issue tracking, not active runbooks.
- Before adding or upgrading an npm package or Docker image, verify the latest compatible stable version from current primary sources. Pin npm packages exactly, commit the lockfile, and pin container images by stable tag and digest; never use `latest`.

## Database and security

- For the Supabase-managed database, create migrations with the Supabase CLI and keep migrations, declarative schema, seed data, and pgTAP tests in sync.
- For the independent Data Foundation database, use its checked-sum SQL migration runner, advisory lock, and canonical `infrastructure/data-foundation/postgres/migrations` directory. Never mix its history with Supabase migrations.
- Supabase Auth is the single WISER authority for users, sessions, tenants, projects, memberships, and delegated identities. Data stores keep only scoped subject references and never create a second Auth system.
- Enable RLS on every table in an exposed schema. Authorization must include ownership checks, not only the `authenticated` role.
- Keep hidden outcomes, rules, jobs, credentials, and idempotency records in private schemas.
- Complex state changes use explicit PostgreSQL transactions, row locks or optimistic versions, unique constraints, and append-only audit events.
- Never commit secrets or mount `~/.codex/auth.json` into containers.

## Verification

- Before coding, run `pnpm docpact:route --paths '<actual intended path or glob>'` and read the returned documents.
- After coding, run `pnpm docpact:check`; update required documents or record an explicit Docpact review before committing.
- Validate governance changes with `pnpm docpact:validate`. Do not use baselines or waivers as routine suppressions.

Run `pnpm verify` before each green milestone. Database and browser changes require their focused integration and Playwright checks as well.
