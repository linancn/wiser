# Interaction protocol

## Required environment

```text
AGENT_EXCON_API_URL   HTTP base, for example http://127.0.0.1:3001
AGENT_EXCON_API_KEY   Participant credential; never print or commit it
```

MCP clients may use the equivalent `agent-excon-mcp-server` tools. MCP is an HTTP adapter and follows the same authorization, idempotency, and version rules.

## Participant flow

| Intent                       | HTTP operation                           | MCP tool                       | Mutation            |
| ---------------------------- | ---------------------------------------- | ------------------------------ | ------------------- |
| Start                        | `POST /api/v1/episodes`                  | `excon_start_episode`          | Yes                 |
| Observe released information | `POST /api/v1/episodes/{id}/observe`     | `excon_observe`                | Yes: records access |
| List delivered observations  | `GET /api/v1/episodes/{id}/observations` | returned by observe            | No                  |
| Submit plan                  | `POST /api/v1/episodes/{id}/submissions` | `excon_submit_allocation_plan` | Yes                 |
| Read feedback                | `GET /api/v1/episodes/{id}/feedback`     | `excon_get_feedback`           | No                  |
| Advance checkpoint           | `POST /api/v1/episodes/{id}/advance`     | `excon_advance`                | Yes                 |
| Read trace                   | `GET /api/v1/episodes/{id}/events`       | resource/client call           | No                  |

Every write sends `Idempotency-Key`. Submission and advance also send the last observed Episode `version`. Keep idempotency keys opaque, 8–128 characters, and unique per intended command.

## Response discipline

- `200/201`: accept the returned resource and version.
- `202`: work is queued. Read the evaluation endpoint using bounded backoff; do not resubmit.
- `409`: version or idempotency conflict. Fetch the Episode, compare intent, and only then decide whether a new command is appropriate.
- `422`: the plan or evidence is invalid. Correct only the reported participant-visible issue.
- `401/403`: stop. Credentials or membership require operator action.
- `5xx` or timeout after a write: retry once with the identical idempotency key; if still ambiguous, stop and retrieve state.

Recommended polling intervals are 0.5, 1, 2, 4, then 8 seconds, capped at 8 seconds. Stop after the task's stated time budget or when the API returns a terminal state.
