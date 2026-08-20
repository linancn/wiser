---
title: TDD contribution guide
description: Drive implementation, refactoring, and small commits from the fact-anchored synthetic Yongding River dispatch case.
---

## Workflow

Every behavior change begins with a failing test that names a business risk. Tests are executable protocol, state-machine, and security documentation.

```text
Choose real behavior → failing test → smallest implementation → full verification → refactor → small commit
```

For “an unreleased source-availability revision cannot be cited”:

1. **Red:** at T+06, cite an upstream inflow revision released at T+12 and expect a stable error code.
2. **Green:** implement only Observation ownership and release-time checks.
3. **Refactor:** extract one domain policy reused by HTTP, SDK, and MCP.
4. **Commit:** keep the test and behavior together; name the outcome in the message.

## Test layers

| Layer                | Scope                                                | Tool                        |
| -------------------- | ---------------------------------------------------- | --------------------------- |
| Unit                 | State transitions, scores, Zod schemas               | Vitest                      |
| API component        | Status, idempotency, error envelope                  | Vitest + Fastify `inject()` |
| Database integration | Migrations, constraints, RLS, locks, event atomicity | Real Compose PostgreSQL     |
| Contract             | Shared HTTP, SDK, and MCP fixtures                   | Vitest                      |
| Browser E2E          | Chinese default, English switch, admin paths         | Playwright                  |
| AI smoke             | Provider credentials and minimal call                | Explicit opt-in only        |

Do not replace critical transactions or RLS with an in-memory database. Conversely, default AI tests must use a fake adapter for deterministic, zero-cost results.

## Definition of done

A change includes failing-then-passing tests, negative/security/idempotency cases, synchronized Chinese and English docs, replayable migrations, and passing format, lint, typecheck, test, and build commands. It introduces no mandatory live-model call and ends in a focused, revertible Git commit.
