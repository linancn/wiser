# Agent EXCON repository instructions

## Delivery discipline

- Work in small Red → Green → Refactor loops. Confirm every new test fails for the expected reason before implementation.
- Keep `packages/core` pure and deterministic. It must not import database, HTTP, framework, clock, random, filesystem, or AI provider code.
- Dependency direction is `contracts <- core <- infra/apps`. MCP calls the HTTP API and never reads the database directly.
- AI never produces deterministic scores or verdicts. Tests and CI use the fake provider; trusted host-only development may use the local Codex CLI provider.
- Every visible UI message belongs in both locale dictionaries. Chinese (`zh-CN`) is the default.

## Database and security

- Create migrations with the Supabase CLI and keep migrations, declarative schema, and tests in sync.
- Enable RLS on every table in an exposed schema. Authorization must include ownership checks, not only the `authenticated` role.
- Keep hidden outcomes, rules, jobs, and idempotency records in a private schema.
- Complex state changes use explicit PostgreSQL transactions, row locks or optimistic versions, unique constraints, and append-only audit events.
- Never commit secrets or mount `~/.codex/auth.json` into containers.

## Verification

Run `pnpm verify` before each green milestone. Database and browser changes require their focused integration and Playwright checks as well.
