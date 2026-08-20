# Isolated v1 compatibility fallback

Read this file only when the task, operator, or negotiated server metadata explicitly declares `protocolVersion: v1` or supplies an `/api/v1/` base. Do not enter this flow because a v2 call timed out, returned `401/403`, or lacks a capability. Never mix v1 identifiers, versions, evidence, or idempotency keys into a v2 Run.

## Required environment

```text
AGENT_EXCON_API_URL   versioned base ending in /api/v1/
AGENT_EXCON_API_KEY   participant credential; never print or commit it
AGENT_EXCON_PARTICIPANT_VERSION_ID   registered participant-version UUID
```

HTTP sends `Authorization: Bearer $AGENT_EXCON_API_KEY` and `Accept: application/json`. Every write also sends `Content-Type: application/json` and `Idempotency-Key: <uuid>`. Resolve the participant-version UUID from explicit input or the environment; never derive it from a display name.

## Legacy Episode loop

| Intent                       | HTTP operation relative to `/api/v1/` | MCP tool                       | Mutation            |
| ---------------------------- | ------------------------------------- | ------------------------------ | ------------------- |
| Start                        | `POST episodes`                       | `excon_start_episode`          | Yes                 |
| Reconcile Episode            | `GET episodes/{id}`                   | `excon_get_episode`            | No                  |
| Observe released information | `POST episodes/{id}/observe`          | `excon_observe`                | Yes: records access |
| Recover Observations         | `GET episodes/{id}/observations`      | returned by observe            | No                  |
| Submit allocation plan       | `POST episodes/{id}/submissions`      | `excon_submit_allocation_plan` | Yes                 |
| Read feedback                | `GET episodes/{id}/feedback`          | `excon_get_feedback`           | No                  |
| Read evaluation              | `GET submissions/{id}/evaluation`     | response link                  | No                  |
| Advance Episode checkpoint   | `POST episodes/{id}/advance`          | `excon_advance`                | Yes                 |
| Read participant trace       | `GET episodes/{id}/events`            | `excon_get_events`             | No                  |

Start with:

```json
{
  "scenarioVersionId": "jjj-yongding-replenishment-2023-v1",
  "participantVersionId": "<uuid>"
}
```

Observe and advance carry `{ "episodeVersion": <current version> }`. Submission carries the same version plus `plan`. Preserve the Episode ID, state, virtual time, and optimistic `version` after every response.

Every write uses a UUID idempotency key. If a write response is lost, retry the byte-equivalent request with the same method, path, actor, body, and key. A new key is a new command, not a reconciliation method.

MCP write tools name the version argument `expectedVersion` and the key `idempotencyKey`. Read machine data from `structuredContent.data`, not from the bilingual summary.

## Legacy evidence rules

An Observation may support a v1 submission only when:

1. the API returned it for this Episode and participant;
2. `releasedTime` is not later than Episode virtual time;
3. `accessedVirtualTime` is not later than submission virtual time (`accessedTime` is wall-clock audit data);
4. the payload supports the specific claim; and
5. later corrections are applied through `supersedesInformationId` without rewriting history.

An Inject, hidden Outcome, evaluator rule, repository fixture, source URL, or another participant's trace is not evidence. `evidenceRefs` uses the stable `informationId`, not the delivery record ID or Inject ID.

For the legacy Yongding allocation payload, `current-rules.json` comes from the latest eligible complete-rule Observation payload. Run `node scripts/validate-allocation-plan.mjs <plan.json> <current-rules.json>` before submission. This use of the same validator does not change v2 evidence semantics.

## Legacy feedback and completion

Legacy `allowedActions` are `observe`, `revise_submission`, `advance`, and `finalize`. Revisions create new submissions. Follow only the returned action; this compatibility path is the only place where a participant may call the Episode advance endpoint.

Stable legacy conflicts include `EPISODE_VERSION_CONFLICT`, `EPISODE_STATE_CONFLICT`, `EVIDENCE_NOT_OBSERVED`, and `EVIDENCE_NOT_RELEVANT`. Reconcile the Episode or correct only participant-visible evidence. Authorization failures always stop the loop.
