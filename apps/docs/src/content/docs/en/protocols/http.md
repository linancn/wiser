---
title: HTTP API
description: Agent EXCON v1 resources, idempotency, state, authentication, and errors.
---

## Foundation

HTTP is the only business protocol foundation. Web clients, SDKs, Skill scripts, and MCP call it instead of domain tables. The base path is `/api/v1`; breaking semantics require a new major version.

## Resources

| Method | Path                                     | Purpose                                 |
| ------ | ---------------------------------------- | --------------------------------------- |
| `POST` | `/episodes`                              | Create from a pinned ScenarioVersion    |
| `GET`  | `/episodes/{episodeId}`                  | Read state and virtual time             |
| `POST` | `/episodes/{episodeId}/observe`          | Deliver released data and record access |
| `GET`  | `/episodes/{episodeId}/observations`     | Read participant observations           |
| `POST` | `/episodes/{episodeId}/submissions`      | Create an immutable revision            |
| `GET`  | `/submissions/{submissionId}`            | Read one immutable revision             |
| `GET`  | `/submissions/{submissionId}/evaluation` | Read evaluation status/result           |
| `GET`  | `/episodes/{episodeId}/feedback`         | Read visible feedback                   |
| `POST` | `/episodes/{episodeId}/advance`          | Authorized virtual-time advance         |
| `GET`  | `/episodes/{episodeId}/events`           | Cursor-paginated visible events         |

## Idempotency

Every POST accepts a UUID `Idempotency-Key`. Retrying the same actor, operation, key, and body returns the original resource. Reusing a key with a different body returns `409`. Observe, submit, and advance also carry the latest `episodeVersion`.

Start uses `{ "scenarioVersionId": "jjj-yongding-replenishment-2023-v1", "participantVersionId": "<uuid>" }`. Observe uses `{ "episodeVersion": 1 }`; submit wraps the complete allocation plan as `{ "episodeVersion": 2, "plan": { ... } }`; advance uses `{ "episodeVersion": 5 }`. A stage-two final plan completes through advance; there is no separate finalize route.

Submission returns `submissionId`, synchronous deterministic `evaluation`, `feedback`, and reconciliation links. `GET /submissions/{id}/evaluation` is safe to retry and may return `202` in an asynchronous repository implementation.

## Errors

```json
{
  "error": {
    "code": "EVIDENCE_NOT_OBSERVED",
    "message": "The submission cites evidence not observed by this participant.",
    "traceId": "01J...",
    "details": { "claimId": "release-plan-01" }
  }
}
```

Details contain only authorized information. For an unreleased object, the API must not confirm whether it exists. Use `401` for identity, `403` for a known forbidden operation, `404` for absent/undisclosable resources, `409` for state/version/idempotency conflicts, and `422` for schema, field-range, evidence, or domain-rule failures.

| Status | Meaning                                               |
| ------ | ----------------------------------------------------- |
| `401`  | Missing or invalid identity                           |
| `403`  | Operation forbidden on a known resource               |
| `404`  | Resource absent or its existence cannot be disclosed  |
| `409`  | State, version, or idempotency conflict               |
| `422`  | Schema, field-range, evidence, or domain-rule failure |
| `429`  | Rate limited; includes `Retry-After`                  |

## Consistency and authentication

Writes validate the Episode version. Durable repositories lock the row inside a transaction so state and Event commit atomically; event lists use stable sequence cursors.

Web users authenticate with Supabase Auth sessions. External agents use revocable, hashed, scoped tokens such as `episode:create`, `observation:read`, and `submission:create`. Service-role and database credentials never reach participants.
