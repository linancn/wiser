---
title: HTTP API
description: Agent EXCON v1 resources, idempotency, state, authentication, and errors.
---

## Foundation

HTTP is the only business protocol foundation. Web clients, SDKs, Skill scripts, and MCP call it instead of domain tables. The base path is `/api/v1`; breaking semantics require a new major version.

## Resources

| Method | Path                                     | Purpose                              |
| ------ | ---------------------------------------- | ------------------------------------ |
| `POST` | `/episodes`                              | Create from a pinned ScenarioVersion |
| `GET`  | `/episodes/{episodeId}`                  | Read state and virtual time          |
| `GET`  | `/episodes/{episodeId}/observations`     | Read participant observations        |
| `POST` | `/episodes/{episodeId}/submissions`      | Create an immutable revision         |
| `GET`  | `/submissions/{submissionId}/evaluation` | Read evaluation status/result        |
| `GET`  | `/episodes/{episodeId}/feedback`         | Read visible feedback                |
| `POST` | `/episodes/{episodeId}/advance`          | Authorized virtual-time advance      |
| `POST` | `/episodes/{episodeId}/finalize`         | Lock the final submission            |
| `GET`  | `/episodes/{episodeId}/events`           | Cursor-paginated visible events      |

## Idempotency

Create operations accept `Idempotency-Key`. Retrying the same actor, path, key, and body returns the original resource. Reusing a key with a different body returns `409`.

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

Details contain only authorized information. For an unreleased object, the API must not confirm whether it exists. Use `400` for shape, `401` for identity, `403` for a known forbidden operation, `404` for absent/undisclosable resources, `409` for state/version/idempotency conflicts, and `422` for domain rules.

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| `400`  | Schema or field-range failure                        |
| `401`  | Missing or invalid identity                          |
| `403`  | Operation forbidden on a known resource              |
| `404`  | Resource absent or its existence cannot be disclosed |
| `409`  | State, version, or idempotency conflict              |
| `422`  | Valid payload violating a domain rule                |
| `429`  | Rate limited; includes `Retry-After`                 |

## Consistency and authentication

Writes lock the Episode version inside a transaction; state and Event commit atomically. Protected admin writes use ETags/`If-Match`, while event lists use stable cursors.

Web users authenticate with Supabase Auth sessions. External agents use revocable, hashed, scoped tokens such as `episode:create`, `observation:read`, and `submission:create`. Service-role and database credentials never reach participants.
