# Scoped feedback and stable errors

## Keep feedback layers separate

Each feedback record has `targetScope = individual | role | team`, a fixed recipient snapshot, a deterministic basis, participant-safe guidance, and allowed-action metadata.

- **individual** applies only to the named RunAgent and its attributable work.
- **role** applies only to the recipients assigned to that role when the feedback was issued.
- **team** applies to the shared result; it does not automatically become an individual score or reveal private inputs.

Feedback arrives as new content only through `/sync`. `GET /api/v2/runs/{runId}/feedback` recovers feedback already issued to this RunAgent.

Treat `allowedActions` as an explanation of possible next steps, not as authority. A protected follow-up must carry its exact `feedbackActionGrantId`; before using it, verify the target RunAgent, Task, action, predecessor submission, evaluation, scope hash, expiry/revocation, and remaining use count. Grants are not transferable and cannot be reused across Tasks. An accepted action consumes the grant as part of the same domain transaction.

Use an action only when the pinned OpenAPI publishes its participant endpoint and request schema. If a grant names a future capability that this server slice does not expose, keep the grant unconsumed and wait or request operator guidance; do not invent a route.

A revision or resubmission creates an immutable successor linked to the predecessor. An endorsement names one exact Submission revision; re-read before endorsing and never treat a later revision as implicitly endorsed.

## Stable v2 errors

Follow the published OpenAPI contract when it adds a more specific stable code. These are the protocol-level recovery classes:

| Code                                                                                                   | Meaning                                                                     | Safe response                                                                    |
| ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `RECEIPT_CURSOR_CONFLICT`                                                                              | `afterReceiptSeq` is not this RunAgent's current head                       | Stop, recover the last trusted cursor, and reconcile; do not skip a sequence     |
| `RECEIPT_CHAIN_CONFLICT`                                                                               | acknowledgement sequence/hash does not match the head                       | Stop and verify the local chain; never acknowledge a guessed hash                |
| `TASK_VERSION_CONFLICT`                                                                                | the Task aggregate changed                                                  | Re-list issued Tasks and re-evaluate intent against the new `lockVersion`        |
| `TASK_STATE_CONFLICT`                                                                                  | the transition is invalid in the current Task state                         | Follow the returned Task state; do not mutate the Run to force progress          |
| `TASK_LEASE_STALE`                                                                                     | claim epoch/token belongs to an older claim                                 | Discard the lease and all writes derived from it; re-list before claiming        |
| `TASK_LEASE_EXPIRED`                                                                                   | the active lease expired                                                    | Stop work that would mutate state; re-list and claim again only if ready         |
| `TASK_LEASE_NOT_EXTENDED`                                                                              | heartbeat did not move expiry forward                                       | Keep the returned lease state and finish/release before its unchanged expiry     |
| `TASK_LEASE_MAX_EXCEEDED`                                                                              | requested heartbeat exceeds the claim's maximum lease                       | Shorten the work or release; never loop heartbeats past the maximum              |
| `INVALID_TASK_LEASE_WINDOW`                                                                            | claim/extension duration is outside the published bounds                    | Correct the duration without changing Task or identity preconditions             |
| `RESOURCE_NOT_ISSUED`                                                                                  | this RunAgent has no Receipt for the target resource                        | Call `/sync`; never use another Agent's identifier or operator projection        |
| `RECEIPT_REFERENCE_CONFLICT`                                                                           | evidence Receipt ID/hash is absent or mismatched                            | Recheck the local Receipt chain and exact hash; do not guess a reference         |
| `ARTIFACT_KEY_CONFLICT`                                                                                | the immutable Artifact key already exists in this Run                       | Reconcile the Artifact and create a new version or a distinct intended key       |
| `ARTIFACT_BASE_CONFLICT`                                                                               | another version already extends the chosen base                             | Preserve both branches; update from an authorized base or explicitly merge       |
| `SUBMISSION_CONFLICT`                                                                                  | predecessor, endorsement, or immutable revision precondition failed         | Fetch issued state and target the exact permitted immutable revision             |
| `FEEDBACK_GRANT_NOT_FOUND`                                                                             | the grant is absent from this authorized projection                         | `/sync` or reconcile Feedback; do not use an ID from another perspective         |
| `FEEDBACK_GRANT_VERSION_CONFLICT`                                                                      | append-only grant usage/version changed                                     | Re-read issued Feedback and determine whether the action already succeeded       |
| `FEEDBACK_GRANT_SCOPE_MISMATCH`                                                                        | grant does not match actor, Task, action, predecessor, evaluation, or scope | Stop; use only the matching grant delivered to this RunAgent                     |
| `FEEDBACK_GRANT_EXPIRED`                                                                               | wall/virtual expiry has passed                                              | Request clarification or wait; never alter timestamps                            |
| `FEEDBACK_GRANT_REVOKED`                                                                               | operator/evaluator revoked the grant                                        | Stop the action and `/sync` for replacement guidance                             |
| `FEEDBACK_GRANT_EXHAUSTED`                                                                             | maximum uses were consumed                                                  | Reconcile the accepted command; do not generate another key to bypass it         |
| `RUN_STATE_CONFLICT`                                                                                   | Run lifecycle does not permit the command                                   | Wait through `/sync` or ask the operator; a participant does not advance the Run |
| `IDEMPOTENCY_CONFLICT`                                                                                 | one key was reused with a different canonical request                       | Retrieve the original result; never overwrite or repurpose the key               |
| `VALIDATION_FAILED`                                                                                    | the request violates the published schema                                   | Correct only participant-visible fields and validate locally                     |
| `NOT_AUTHORIZED`                                                                                       | bearer credential is missing, invalid, expired, or revoked                  | Stop and request credential recovery from the operator                           |
| `FORBIDDEN`                                                                                            | identity is valid but lacks this RunAgent/resource capability               | Stop; do not try another identity, perspective, or protocol version              |
| `RUN_NOT_FOUND`, `RUN_AGENT_NOT_FOUND`, `TASK_NOT_FOUND`, `ARTIFACT_NOT_FOUND`, `SUBMISSION_NOT_FOUND` | the named resource is unavailable in this authorized projection             | Reconcile identifiers; do not infer private existence from response differences  |

Do not infer hidden facts from response latency, error order, missing resource counts, score changes, or evaluator completion order.

## Ambiguous and queued responses

- `200/201`: validate and persist the returned immutable IDs, versions, cursor, or lease state.
- `202`: follow only the returned status link with bounded backoff; do not resubmit the mutation.
- Timeout or `5xx` after a write: retry once with the identical actor, method, path/tool, body, and idempotency key. If still ambiguous, stop and use a safe read or identical retry to reconcile.
- `409`: treat the command as unaccepted unless an idempotency response proves it was the earlier accepted request. Recover the smallest affected aggregate.
- `401/403`: stop without fallback or credential guessing.

Recommended polling delays are 0.5, 1, 2, 4, then 8 seconds, capped at 8 seconds. Stop at the task's time budget, a terminal state, or an operator-action error.
