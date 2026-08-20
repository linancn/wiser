# Interaction protocol

## Required environment

```text
AGENT_EXCON_API_URL   HTTP base, for example http://127.0.0.1:3001/api/v1/
AGENT_EXCON_API_KEY   Participant credential; never print or commit it
AGENT_EXCON_PARTICIPANT_VERSION_ID   Registered participant-version UUID
```

MCP clients may use the equivalent `agent-excon-mcp-server` tools. MCP is an HTTP adapter and follows the same authorization, idempotency, and version rules.

HTTP sends `Authorization: Bearer $AGENT_EXCON_API_KEY` and `Accept: application/json`. Every write also sends `Content-Type: application/json` and `Idempotency-Key: <uuid>`. Resolve the participant-version UUID from explicit task input or the environment above; never derive it from a display name.

All operation paths below are relative to `AGENT_EXCON_API_URL`, which already ends in `/api/v1/`. Do not append the version prefix twice.

## Participant flow

| Intent                       | HTTP operation                    | MCP tool                       | Mutation            |
| ---------------------------- | --------------------------------- | ------------------------------ | ------------------- |
| Start                        | `POST episodes`                   | `excon_start_episode`          | Yes                 |
| Reconcile Episode state      | `GET episodes/{id}`               | `excon_get_episode`            | No                  |
| Observe released information | `POST episodes/{id}/observe`      | `excon_observe`                | Yes: records access |
| List delivered observations  | `GET episodes/{id}/observations`  | returned by observe            | No                  |
| Submit plan                  | `POST episodes/{id}/submissions`  | `excon_submit_allocation_plan` | Yes                 |
| Read feedback                | `GET episodes/{id}/feedback`      | `excon_get_feedback`           | No                  |
| Read evaluation              | `GET submissions/{id}/evaluation` | response link / feedback       | No                  |
| Advance checkpoint           | `POST episodes/{id}/advance`      | `excon_advance`                | Yes                 |
| Read trace                   | `GET episodes/{id}/events`        | `excon_get_events`             | No                  |

Every write sends `Idempotency-Key`. Observe, submission, and advance also send the last observed Episode `version`. This API version requires a UUID idempotency key; keep it opaque and unique per intended command.

## Exact write envelopes

```json
// POST /episodes
{
  "scenarioVersionId": "jjj-yongding-replenishment-2023-v1",
  "participantVersionId": "<uuid>"
}

// POST /episodes/{id}/observe
{ "episodeVersion": 1 }

// POST /episodes/{id}/submissions
{
  "episodeVersion": 2,
  "plan": { "stage": 1, "sourceReleases": [], "expectedSectionFlows": [], "isFinal": false }
}

// POST /episodes/{id}/advance
{ "episodeVersion": 5 }
```

Use the complete plan shape from `yongding-allocation.md`; the abbreviated arrays above show only the envelope. Start, observe, submit, and advance responses all return the updated `episode`. Submission also returns `submissionId`, deterministic `evaluation`, `feedback`, and links for reconciliation. The service assigns revision numbers and immutable predecessor links; the participant does not send `revisionOf` in this protocol version.

When feedback returns `revise_submission`, send the revised plan to the same submissions endpoint with the current `feedback_available` Episode version and a new idempotency key. Keep the same stage and set `isFinal` according to that stage. The response increments `revisionNo` and sets `revisionOf`; it never overwrites the earlier plan.

`allowedActions` values are `observe`, `revise_submission`, `advance`, and `finalize`. Stage 1 normally returns `advance`; a valid stage-2 final plan returns `finalize`, which is executed through the same advance endpoint with the latest version.

MCP write tools name the version argument `expectedVersion` and the header value `idempotencyKey`; the adapter converts them to the HTTP envelope above. MCP results use `structuredContent: { "ok": true, "data": <HTTP response> }` or `{ "ok": false, "error": ... }`. Read machine fields from `data`, never from the bilingual text summary.

## Response discipline

- `200/201`: accept the returned resource and version.
- `202`: work is queued. Follow the returned evaluation or feedback link using bounded backoff; do not resubmit.
- `409`: version or idempotency conflict. Fetch the Episode, compare intent, and only then decide whether a new command is appropriate.
- `422`: the plan or evidence is invalid. Correct only the reported participant-visible issue.
- `401/403`: stop. Credentials or membership require operator action.
- `5xx` or timeout after a write: retry once with the identical idempotency key; if still ambiguous, stop and retrieve state.

If a write response is lost, repeat the identical method, path, body, actor, and idempotency key. The server returns the original response, including the submission ID and reconciliation links. Never invent a new key merely to discover whether the first request succeeded.

Recommended polling intervals are 0.5, 1, 2, 4, then 8 seconds, capped at 8 seconds. Stop after the task's stated time budget or when the API returns a terminal state.
