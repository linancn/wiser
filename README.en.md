# Agent Exercise Control Infrastructure · Agent EXCON

English · [中文（默认）](./README.md)

Agent EXCON is an interactive task environment and exercise-control infrastructure for heterogeneous agents. It packages real-world work as runnable, replayable, and verifiable scenarios exposed through HTTP, MCP, and versioned file-based Skills.

The repository starts with one testable vertical slice: a two-stage historical urban-flood replay. A participant only sees information released by the current virtual time and actually observed by that participant. Structured predictions receive deterministic evaluation and feedback before the exercise advances.

## Engineering principles

- Real-use-case Red → Green → Refactor: tests define behavior before implementation.
- Deterministic evaluation first; AI may explain a verdict but never decides scores.
- Local development reuses `codex login` by default; CI and deployments use a fake or OpenAI-compatible provider.
- Supabase supplies Auth, PostgreSQL, Storage, and local tooling; complex transactions use `pg` and SQL.
- PostgreSQL state tables handle initial asynchronous work without Redis or another message broker.
- Chinese is the default UI and documentation locale, with matching English content.

## Intended workspace

```text
apps/          Web, worker, MCP, and Starlight documentation
packages/      Contracts, pure domain core, and infrastructure adapters
scenarios/     Versioned scenarios and provenance manifests
skills/        Independently publishable Agent EXCON Skill
supabase/      Configuration, migrations, seeds, and database tests
tests/         Cross-boundary acceptance tests
```

## Environment baseline

- Node.js 24 LTS (`24.19.0` recommended; compatible range `>=24.18.0 <25`)
- pnpm 11
- Docker Engine 29+ / Docker Compose 5+
- Codex CLI (the default local AI provider)

Install and verify:

```bash
corepack enable
pnpm install
pnpm verify
```

Supabase, Compose, and scenario runbooks will land with the vertical slice under `apps/docs`. Never commit `~/.codex/auth.json`, Supabase service-role keys, or other credentials.

## Project status

This project is at the walking-skeleton stage. Scope and acceptance criteria live in [`docs/roadmap.md`](./docs/roadmap.md); contribution rules are in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## License

Code is available under the [MIT License](./LICENSE). Scenario data and third-party materials retain the licenses declared in their own `PROVENANCE.md`; the MIT license does not automatically cover them.
