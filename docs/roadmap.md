# Walking-skeleton roadmap / 首个纵向切片

## Goal

Run one fixed, versioned, two-stage Jing-Jin-Ji water-system exercise from episode creation through observation, allocation planning, deterministic feedback, virtual-time advance, final evaluation, and audit replay. The case models coordinated ecological replenishment and multi-source allocation along the Yongding River system.

## Acceptance boundary

1. An episode begins in `AWAITING_SUBMISSION` with only stage-one information released.
2. Reading an observation records immutable access; a submission cannot cite unreleased or unobserved evidence.
3. A valid submission and its PostgreSQL evaluation job are created atomically and idempotently.
4. A worker claims work with `FOR UPDATE SKIP LOCKED`; retries cannot create a second evaluation.
5. Stage-one feedback cannot inspect or leak future outcomes.
6. Advancing virtual time releases the next inject atomically; conflicting versions return a stable conflict error.
7. The final deterministic evaluator reports target coverage, source and corridor compliance, over-allocation, evidence coverage, and time-travel violations.
8. Event sequence numbers remain monotonic and support a complete read-only replay.
9. RLS prevents one participant from seeing another participant's episode; public roles cannot read hidden outcomes.
10. HTTP and MCP use the same versioned Zod contracts; the MCP adapter only calls HTTP.
11. `/` redirects to `/zh-CN`; `/en` contains matching controls and preserves the current episode during locale switches.
12. Local Codex, OpenAI-compatible, and fake AI providers satisfy one contract, while only the fake runs in CI.

## Milestones

- M1 — MIT workspace, contracts, pure state machine, deterministic evaluator, scenario provenance, and CI.
- M2 — Supabase migration/RLS, PostgreSQL job worker, HTTP API, and database acceptance flow.
- M3 — bilingual console, stdio MCP, versioned Skill, Starlight docs, AI provider adapters, and Playwright gate.

Out of scope for the first slice: visual scenario editor, uploads, GIS maps, pause/rewind, multi-agent roles, live mode, comparison dashboards, LLM judging, remote MCP/OAuth, Kubernetes, and a full observability stack.
