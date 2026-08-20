# Agent EXCON API

Fastify HTTP boundary used by the versioned Agent EXCON Skill and the stdio MCP adapter. The Web app is read-only and is not the participant interface.

```bash
AGENT_EXCON_PARTICIPANT_TOKEN=local-demo-participant-token \
API_PORT=3001 \
pnpm --filter @agent-excon/api dev
```

The default `InMemoryExerciseService` is a deterministic walking-slice adapter for local demos and contract tests. It is intentionally non-durable. Production must inject a PostgreSQL/Supabase repository implementing `ExerciseService`; HTTP handlers, Skill, and MCP contracts do not change.

Participant requests use `Authorization: Bearer <token>`. Every POST uses a UUID `Idempotency-Key`; observe, submit, and advance also include `episodeVersion`.

Key routes:

- `GET /health/live`, `GET /health/ready`, `GET /openapi.json`
- `GET /api/v1/scenario`
- `POST /api/v1/episodes`, `GET /api/v1/episodes/{id}`
- `POST /api/v1/episodes/{id}/observe`, `GET .../observations`
- `POST /api/v1/episodes/{id}/submissions`
- `GET /api/v1/submissions/{id}/evaluation`
- `GET /api/v1/episodes/{id}/feedback`
- `POST /api/v1/episodes/{id}/advance`
- `GET /api/v1/episodes/{id}/events`

Deterministic evaluation never calls an LLM. AI adapters may create explanatory summaries outside the scoring boundary.
