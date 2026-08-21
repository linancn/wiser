# v2 RunAgent interaction protocol

The published `/openapi.json`, assignment/Task schemas, and structured MCP results are the wire authority. This reference fixes the safe interaction order and the v2 route/tool intent; do not invent fields when a pinned contract differs.

## Trusted bootstrap and headers

Resolve these values from explicit operator input, a credential exchange, or a trusted runtime secret store:

```text
API origin                 for example http://127.0.0.1:3001
runId                      assigned ExerciseRun UUID
expected runAgentId        concrete RunAgent UUID, never a display label
RunAgent bearer credential short-lived and bound to that RunAgent/Run
```

Every protected HTTP call sends:

```http
Authorization: Bearer <RunAgent credential>
X-Run-Agent-Id: <runAgentId>
Accept: application/json
```

Every POST also sends `Content-Type: application/json` and a UUID `Idempotency-Key`. The server binds the bearer credential and `X-Run-Agent-Id`; an operator token cannot act as a participant.

Call `GET /api/v2/runs/{runId}/me` first. It returns `runAgent`, `roleAssignment`, `role`, and `syncCursor`; require `runAgent.id`, `runAgent.runId`, and the assignment to match the trusted bootstrap. Reconcile the local Receipt cursor with `syncCursor` before any write. In a negotiated earlier v2 slice without `/me`, the bootstrap plus the first `/sync` response is the identity envelope: require its `runId` and `runAgentId` to match before processing any Receipt. A missing `/me` is not permission to select another identity or downgrade.

Cursor reconciliation is conservative:

- Same sequence and hash: continue.
- Server sequence is ahead because a prior process issued content: retrieve this RunAgent's own `deliverySemantics=issued` replay, rebuild and verify its Receipt chain through the server head, recover the issued resources, then persist the rebuilt cursor. Do not call `/sync` with a knowingly stale `afterReceiptSeq`.
- Local sequence is ahead, or the same sequence has a different hash: stop with a chain-integrity incident. Never trim, skip, or replace the local ledger merely to match.

## Operation map

| Intent                     | HTTP                                                   | Recommended MCP tool             | Mutation |
| -------------------------- | ------------------------------------------------------ | -------------------------------- | -------- |
| Reconcile assignment       | `GET /api/v2/runs/{runId}/me`                          | `excon_get_assignment`           | No       |
| Receive and acknowledge    | `POST /api/v2/runs/{runId}/sync`                       | `excon_sync`                     | Yes      |
| Recover issued Tasks       | `GET /api/v2/runs/{runId}/tasks`                       | `excon_list_tasks`               | No       |
| Claim Task lease           | `POST /api/v2/tasks/{taskId}:claim`                    | `excon_claim_task`               | Yes      |
| Begin claimed Task         | `POST /api/v2/tasks/{taskId}:begin`                    | `excon_begin_task`               | Yes      |
| Renew active lease         | `POST /api/v2/tasks/{taskId}:heartbeat`                | `excon_heartbeat_task`           | Yes      |
| Release active lease       | `POST /api/v2/tasks/{taskId}:release`                  | `excon_release_task`             | Yes      |
| Send explicit Message      | `POST /api/v2/runs/{runId}/messages`                   | `excon_post_message`             | Yes      |
| Recover issued Messages    | `GET /api/v2/runs/{runId}/messages`                    | structured list result           | No       |
| Publish Artifact           | `POST /api/v2/runs/{runId}/artifacts`                  | `excon_publish_artifact`         | Yes      |
| Append ArtifactVersion     | `POST /api/v2/artifacts/{artifactId}/versions`         | `excon_publish_artifact_version` | Yes      |
| Recover issued Artifacts   | `GET /api/v2/runs/{runId}/artifacts`                   | structured list result           | No       |
| Submit Task result         | `POST /api/v2/tasks/{taskId}/submissions`              | `excon_submit_task_result`       | Yes      |
| Recover issued Submissions | `GET /api/v2/runs/{runId}/submissions`                 | `excon_list_submissions`         | No       |
| Endorse exact Submission   | `POST /api/v2/submissions/{submissionId}/endorsements` | `excon_endorse_submission`       | Yes      |
| Recover issued Feedback    | `GET /api/v2/runs/{runId}/feedback`                    | `excon_get_feedback`             | No       |
| Read own replay cursor     | `GET /api/v2/runs/{runId}/replay`                      | `excon_get_replay_cursor`        | No       |

MCP must call these HTTP operations rather than read PostgreSQL. Read machine fields from `structuredContent.data`; bilingual text is a summary, not a state carrier.

## `/sync`: the only new-content entry

`/sync` is the only operation that can issue a new Task assignment, Inject/message, Artifact grant, Submission, or Feedback to this RunAgent. Recovery GETs return only resources already represented in this Agent's Receipt chain.

First request:

```json
{
  "afterReceiptSeq": 0,
  "maxItems": 50
}
```

After fully processing a non-empty batch, the next request acknowledges its exact head:

```json
{
  "afterReceiptSeq": 17,
  "ack": {
    "throughReceiptSeq": 17,
    "headHash": "sha256:<64 lowercase hex>"
  },
  "maxItems": 50
}
```

Response invariants:

```json
{
  "deliveryBatchId": "<uuid>",
  "runId": "<uuid>",
  "runAgentId": "<uuid>",
  "fromReceiptSeq": 18,
  "throughReceiptSeq": 22,
  "receiptHeadHash": "sha256:<64 lowercase hex>",
  "runCursor": 184,
  "hasMore": false,
  "receipts": []
}
```

For a non-empty batch, receipt sequences must be contiguous from `fromReceiptSeq` through `throughReceiptSeq`; each `previousReceiptHash` must match the trusted prior head, and the final `receiptHash` must equal `receiptHeadHash`. For an empty batch, `fromReceiptSeq` is `null`, `throughReceiptSeq` and the head remain stable, and the batch is still an idempotent, auditable response.

Persist the cursor only after validating and durably processing every Receipt. If `hasMore` is true, call again with a new idempotency key and the new cursor/ack. If the response is lost, retry the identical request with its original key; the server must return the original batch even if newer resources became eligible.

## Task lease envelopes

Claim a `READY` Task using its own current version:

```json
{
  "expectedVersion": 3,
  "leaseSeconds": 120
}
```

`leaseSeconds` is 15–300 seconds and defaults to 60 when omitted.

The response contains the updated `task` and a secret lease envelope:

```json
{
  "task": { "lockVersion": 4, "state": "CLAIMED" },
  "lease": {
    "claimEpoch": 2,
    "leaseToken": "<opaque secret>",
    "leaseExpiresAt": "<timestamp>",
    "maximumLeaseExpiresAt": "<timestamp>"
  }
}
```

Begin or release with:

```json
{
  "expectedVersion": 4,
  "claimEpoch": 2,
  "leaseToken": "<opaque secret>"
}
```

Heartbeat additionally supplies `extendBySeconds` from 1–300. Use the returned Task `lockVersion` for the next transition and never heartbeat beyond `maximumLeaseExpiresAt`. Do not log, message, artifact, or submit the lease token.

## Collaboration and submission envelopes

The published Task schema defines the `payload`, `submissionType`, permitted recipients, and target scope. The current v2 transport envelopes are strict.

Message:

```json
{
  "kind": "inform | request | response | handoff",
  "replyToMessageId": "<required only for response>",
  "recipientRunAgentIds": ["<uuid>"],
  "subject": { "zh-CN": "摘要", "en": "Summary" },
  "body": { "zh-CN": "参与者安全正文", "en": "Participant-safe body" },
  "artifactVersionRefs": [
    {
      "artifactId": "<uuid>",
      "artifactVersionId": "<uuid>",
      "contentHash": "sha256:<64 hex>"
    }
  ]
}
```

Use `handoff` for an immutable ArtifactVersion transfer and include at least one exact reference. Use `request` when an explicit business response is required. A `response` must cite a receipted `request` through `replyToMessageId`, inherits that request's immutable `threadId`, and includes the request sender in its recipient snapshot. The service rejects a response when the caller was not a request recipient or has not obtained the parent through its own Receipt chain. `inform`, `request`, and `handoff` are thread roots and cannot cite a parent.

Receipt issuance and acknowledgement prove only platform delivery-chain state. They never mean “read”, “understood”, or “agreed”. Only a causal `response`, scoped Feedback action, or Endorsement establishes the corresponding business action.

New Artifact and a later immutable version:

```json
{
  "artifactKey": "role-output-key",
  "artifactType": "role-analysis",
  "title": { "zh-CN": "分析工件", "en": "Analysis artifact" },
  "content": {},
  "recipientRunAgentIds": ["<uuid>"]
}
```

```json
{
  "baseVersionId": "<uuid>",
  "content": {},
  "recipientRunAgentIds": ["<uuid>"]
}
```

The server derives and returns the new immutable version/content hash. A base conflict produces `ARTIFACT_BASE_CONFLICT`; preserve the returned/existing branch and never overwrite it.

Include this RunAgent in `recipientRunAgentIds` when it must later extend or cite the version, then `/sync` its own artifact-grant Receipt before that follow-up. Do not add self or teammates who do not need the Artifact merely for convenience.

Task submission:

```json
{
  "expectedVersion": 5,
  "claimEpoch": 2,
  "leaseToken": "wlt_<opaque>",
  "submissionType": "role-analysis",
  "targetScope": "individual",
  "payload": {},
  "receiptRefs": [
    { "receiptId": "<uuid>", "receiptHash": "sha256:<64 lowercase hex>" }
  ],
  "artifactVersionRefs": [
    {
      "artifactId": "<uuid>",
      "artifactVersionId": "<uuid>",
      "contentHash": "sha256:<64 lowercase hex>"
    }
  ],
  "endorsementRecipientRunAgentIds": []
}
```

At least one `receiptRefs` or `artifactVersionRefs` entry is required, and every ArtifactVersion reference must match an artifact Receipt already issued to this RunAgent. A feedback-driven successor adds both `revisionOfId` and `feedbackActionGrantId`; neither may appear alone. A team Submission names the exact RunAgents whose endorsement is required, without including the submitter in that recipient list. Creation makes one immutable Submission snapshot eligible to the author and those endorsement recipients; each RunAgent must obtain its own Submission Receipt through `/sync` before `GET /api/v2/runs/{runId}/submissions` or `excon_list_submissions` can recover it.

Endorse the immutable Submission named in Feedback with:

```json
{ "feedbackActionGrantId": "<uuid>" }
```

The grant is mandatory for endorsement and is consumed against the exact actor, Task, Submission/evaluation, action, scope, expiry, and use count.

Before endorsing, process both the Submission and Feedback Receipts, call `GET /api/v2/runs/{runId}/submissions` or `excon_list_submissions`, select the exact `subjectSubmissionId`/`predecessorSubmissionId`, and verify its revision, actor, Task, payload hash, evidence references, and recipient snapshot. Review that immutable content and its authorized ArtifactVersions. If the exact snapshot is absent, `/sync` with bounded backoff and stop without consuming the grant; never substitute operator replay, a Feedback ID, or a future endpoint.

Record every returned Message ID, Artifact/version ID, Submission ID, Task version, and domain cursor. A successful Message or Artifact write does not make it visible to recipients until their own `/sync` issues a Receipt.

## Feedback, Barrier wait, and replay

After submission, continue bounded `/sync` calls. Evaluation of one Task does not block other agents. Process Feedback only after its Receipt is in the local chain, and use a matching `feedbackActionGrantId` for a protected action.

There is no participant command for advancing the Run clock or releasing a Barrier. Complete the assigned Task, optionally publish a readiness Message if requested, and wait for EXCON to release downstream work through `/sync`.

For handoff, use:

```text
GET /api/v2/runs/{runId}/replay
  ?perspective=agent
  &subjectId={runAgentId}
  &atRunSeq={last trusted runCursor}
  &deliverySemantics=issued|acknowledged
```

A RunAgent cannot request `eligible`, another subject, or an operator/team/role perspective. Keep `authoritativeProjection` separate from `bestEffortTelemetryOverlay`; a telemetry gap never changes Receipt evidence or the replay manifest.

If the trusted `runCursor` is zero, omit `atRunSeq` because the query contract accepts only positive explicit cutoffs.

## Response discipline

- Retry a lost write once with the same key and byte-equivalent request; then stop and reconcile safely.
- Use a new key only for a genuinely new intent after reconciling the smallest aggregate.
- Never change identity headers, task version, lease epoch/token, base version, predecessor, or grant merely to make a rejected command pass.
- Use bounded polling delays of 0.5, 1, 2, 4, then 8 seconds; stop at the stated time budget or terminal/error state.
- Surface the stable error code and safe next action from [feedback-and-errors.md](feedback-and-errors.md).
