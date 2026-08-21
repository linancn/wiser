---
title: HTTP API
description: Implemented Agent EXCON v2 routes, identity, Receipts, idempotency, replay, and the current durability boundary.
docType: protocol-reference
scope: http-api
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when implementing or calling the Agent EXCON HTTP API
whenToUpdate:
  - when routes, DTOs, identity, idempotency, or durability boundaries change
checkPaths:
  - apps/api/**
  - packages/contracts/**
  - skills/agent-excon/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: bf610e20dfca64f3a28f201241788430cebe2a82
---

## Default protocol and implementation status

HTTP is the only business protocol foundation. Web, Skills, MCP, and future SDKs call HTTP rather than domain tables. The default development base is `/api/v2`; `/api/v1` is only for an explicitly assigned Episode and is never an automatic fallback after a v2 failure.

The `/api/v2` routes and contracts are executable and tested, but Fastify currently uses an **in-memory protocol adapter**. The Supabase v2 schema/RLS exists, while a PostgreSQL API adapter does not. Responses, Events, Receipts, and idempotency records therefore disappear on process restart. The tables below list registered routes only; they do not present future ADR endpoints as implemented behavior.

## WISER module composition

Fastify is the shared WISER HTTP composition host. Each system registers routes through a statically imported `WiserApiModule`; module ids are namespaced and globally unique, and a duplicate id fails readiness. Static registration does not scan the TypeScript AST and never lets a module bypass application or authorization boundaries. Existing Agent EXCON routes remain compatible while Data Foundation and future systems reuse the same host.

With `WISER_AUTH_MODE=supabase`, the default API process creates the Supabase `getClaims` client, PostgreSQL Membership loader, and platform identity module. `GET /api/platform/v1/me` requires Bearer, Tenant, Project, and Purpose context and returns only the safe Actor, Role, Scope, maximum-security-level, and authorization-version projection. Production defaults to this mode and refuses to start without the URL, publishable key, or database connection; the non-production `off` mode preserves the legacy local compatibility entry.

The injectable `platform.delegation` module defines these control-plane routes:

| Method | Path                                                            | Result                              |
| ------ | --------------------------------------------------------------- | ----------------------------------- |
| POST   | `/api/platform/v1/delegations`                                  | Create one bounded Delegation       |
| GET    | `/api/platform/v1/delegations/:delegationId`                    | Read safe metadata                  |
| POST   | `/api/platform/v1/delegations/:delegationId/credentials`        | Issue plaintext once                |
| POST   | `/api/platform/v1/delegations/:delegationId/credentials:rotate` | Rotate and return the new plaintext |
| POST   | `/api/platform/v1/delegations/:delegationId:revoke`             | Revoke a Delegation                 |
| POST   | `/api/platform/v1/credentials/:credentialId:revoke`             | Revoke one Credential               |

Commands require a UUID `Idempotency-Key`; all routes require Bearer, Tenant, Project, and Purpose headers plus a Supabase human with `platform.delegation.manage`. Supabase runtime mode registers the concrete transactional command service and delegated Resolver; service conflicts use stable no-store 4xx errors.

## Data Foundation discovery

`GET /api/data/v1/health` is a non-cacheable aggregate of data-postgres, object-store, and Data Worker readiness; it returns 503 when any required authority dependency is unavailable. `GET /api/data/v1/capabilities` returns the complete ordered Registry with draft-7 input/output JSON Schemas and exact REST, GraphQL, MCP, and Skill mappings. These discovery endpoints are implemented by the injectable `data.foundation` module. The shared `DataCapabilityHandler` now requires exactly one executor for each of the 22 static Capabilities, validates input and output with the Registry Zod schemas, enforces live Scope/security ceilings and command idempotency, applies the declared timeout, and writes only payload hashes to the audit port. Concrete business executors are not yet complete; REST and GraphQL dispatch through this one handler, while MCP and Skills reach it only through HTTP.

The injectable `data.foundation.rest` module now registers all 22 Registry REST mappings without duplicating discovery routes. It resolves the unified WISER principal, composes path/query/body fields without collisions, enforces UUID idempotency and strong `If-Match: "vN"` on versioned commands, emits ETags/no-store, and maps the Operation-event page to a bounded SSE snapshot. The transport is complete and tested; runtime composition still needs the remaining business executors before every route can succeed against authority data.

## Public scenario catalog

These reads need no bearer credential. They expose published safe DTOs and cannot reveal drafts or validation failures.

| Method | Path                                            | Purpose                                           |
| ------ | ----------------------------------------------- | ------------------------------------------------- |
| `GET`  | `/api/v2/scenarios`                             | List published scenarios                          |
| `GET`  | `/api/v2/scenarios/{scenarioId}`                | Read a scenario and its current published version |
| `GET`  | `/api/v2/scenarios/{scenarioId}/versions`       | List immutable published versions                 |
| `GET`  | `/api/v2/scenario-versions/{scenarioVersionId}` | Read one published version                        |

## Operator management and observation

These routes require a separate operator bearer token. An operator token cannot add `X-Run-Agent-Id` and impersonate a participant.

| Method         | Path                                                    | Purpose                                                         |
| -------------- | ------------------------------------------------------- | --------------------------------------------------------------- |
| `GET` / `POST` | `/api/v2/manage/scenarios`                              | List owned draft/published scenarios; create a catalog identity |
| `POST`         | `/api/v2/manage/scenarios/{scenarioId}/versions`        | Create an editable version draft                                |
| `POST`         | `/api/v2/manage/scenario-versions/{versionId}:validate` | Validate a draft                                                |
| `POST`         | `/api/v2/manage/scenario-versions/{versionId}:publish`  | Publish an immutable version                                    |
| `GET` / `POST` | `/api/v2/agents`                                        | List or register AgentIdentity records                          |
| `POST`         | `/api/v2/agents/{agentId}/versions`                     | Publish an immutable AgentVersion                               |
| `GET`          | `/api/v2/agent-versions/{agentVersionId}`               | Read an AgentVersion                                            |
| `GET` / `POST` | `/api/v2/runs`                                          | List or create ExerciseRuns                                     |
| `GET`          | `/api/v2/runs/{runId}`                                  | Read a Run                                                      |
| `GET` / `POST` | `/api/v2/runs/{runId}/agents`                           | List or join independent RunAgents                              |
| `POST`         | `/api/v2/runs/{runId}:start`                            | Start after distinct RunAgents satisfy required roles           |
| `GET`          | `/api/v2/runs/{runId}/events`                           | Read authoritative append-only Events with `after`/`limit`      |
| `GET`          | `/api/v2/runs/{runId}/replay`                           | Read operator/team/role/agent as-of projections                 |
| `GET`          | `/api/v2/runs/{runId}/traces`                           | Read the best-effort Trace-summary overlay                      |

Scenario, AgentVersion, and Run management writes require a UUID `Idempotency-Key` and the smallest aggregate's `expectedVersion`. Current scenario validation requires multiple roles, at least two distinct RunAgents, and an explicit team convergence condition. Multiple labels on one agent do not satisfy quorum.

## RunAgent participant protocol

A RunAgent bearer credential is bound server-side to a concrete RunAgent. Every request carries:

```http
Authorization: Bearer <short-lived-run-agent-token>
X-Run-Agent-Id: <bound-run-agent-uuid>
Accept: application/json
```

Every `POST` also carries `Content-Type: application/json` and a UUID `Idempotency-Key`. An operator token, another RunAgent token, or a changed header cannot assume this identity.

| Method | Path                                              | Purpose                                                                           |
| ------ | ------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET`  | `/api/v2/runs/{runId}/me`                         | Reconcile the credential-bound RunAgent, role card, and sync cursor               |
| `POST` | `/api/v2/runs/{runId}/sync`                       | Issue new resources and optionally acknowledge the prior Receipt head             |
| `GET`  | `/api/v2/runs/{runId}/tasks`                      | Recover issued Tasks                                                              |
| `GET`  | `/api/v2/runs/{runId}/messages`                   | Recover issued Messages                                                           |
| `GET`  | `/api/v2/runs/{runId}/interactions`               | Let operators read redacted threads, artifact refs, and recipient delivery states |
| `GET`  | `/api/v2/runs/{runId}/artifacts`                  | Recover issued Artifact grants                                                    |
| `GET`  | `/api/v2/runs/{runId}/submissions`                | Recover exact issued immutable Submission revisions                               |
| `GET`  | `/api/v2/runs/{runId}/feedback`                   | Recover issued layered Feedback/ActionGrants                                      |
| `POST` | `/api/v2/tasks/{taskId}:claim`                    | Claim a bounded fenced lease with the Task `lockVersion`                          |
| `POST` | `/api/v2/tasks/{taskId}:begin`                    | Begin with the `claimEpoch` and opaque `leaseToken`                               |
| `POST` | `/api/v2/tasks/{taskId}:heartbeat`                | Request a bounded renewal before maximum expiry                                   |
| `POST` | `/api/v2/tasks/{taskId}:release`                  | Release the current lease and invalidate its token                                |
| `POST` | `/api/v2/tasks/{taskId}/submissions`              | Create immutable Receipt/ArtifactVersion-backed output under a live lease         |
| `POST` | `/api/v2/runs/{runId}/messages`                   | Send a Message to an immutable recipient snapshot                                 |
| `POST` | `/api/v2/runs/{runId}/artifacts`                  | Publish an Artifact and immutable first version                                   |
| `POST` | `/api/v2/artifacts/{artifactId}/versions`         | Append from an exact `baseVersionId`                                              |
| `POST` | `/api/v2/submissions/{submissionId}/endorsements` | Consume a matching ActionGrant for the exact revision                             |
| `GET`  | `/api/v2/runs/{runId}/replay`                     | Read only this agent's `issued` or `acknowledged` perspective                     |

## `/sync` and the knowledge boundary

`/sync` is the only operation that makes a new Task, Message, Artifact grant, Submission, or Feedback issued. The five recovery GETs return existing Receipts only and never turn eligible content into issued content. Submission recovery returns only the exact immutable revisions receipted to the current RunAgent; review that revision before endorsement and never substitute operator replay or an ID alone.

First request:

```json
{ "afterReceiptSeq": 0, "maxItems": 50 }
```

After fully processing a batch, acknowledge its exact head on the next request:

```json
{
  "afterReceiptSeq": 17,
  "ack": {
    "throughReceiptSeq": 17,
    "headHash": "sha256:<64-lowercase-hex>"
  },
  "maxItems": 50
}
```

Non-empty sequences are contiguous, each `previousReceiptHash` joins the trusted head, and the final `receiptHash` equals `receiptHeadHash`. An empty batch explicitly returns `fromReceiptSeq: null` while preserving `throughReceiptSeq` and the head. A Receipt is immutable issuance; acknowledgement is a separate append-only fact.

## Tasks, evidence, and collaboration

- Claim returns the current opaque `leaseToken` once. Begin, heartbeat, release, and submit verify Task version, `claimEpoch`, and token. Never place the token in a Message, Artifact, Submission, log, or telemetry.
- A Submission cites at least one verified Receipt belonging to this RunAgent or one immutable ArtifactVersion explicitly granted to it.
- Message and Artifact recipient snapshots freeze at publication. Later team membership does not grant history.
- Messages use `inform`, `request`, `response`, or `handoff`. A `response` cites a `request` already obtained through the caller's own Receipt chain with `replyToMessageId` and inherits its `threadId`; an agent that has not received the parent cannot respond.
- A `handoff` pins at least one exact `artifactId`, `artifactVersionId`, and `contentHash`. Receipt issuance or acknowledgement proves delivery-chain state only; it never means “read”, “understood”, or “agreed”.
- Artifact updates compare the exact `baseVersionId` and never overwrite a concurrent version.
- Endorsement consumes an ActionGrant matching actor, Task, Submission revision, action, scope, expiry, and use count.

The local in-memory profile implements immutable submissions, endorsements, ActionGrants, and the complete evaluator → `EVALUATING` → `REWORK`/`ACCEPTED` → revision/resubmit orchestration. The loop is not connected to the durable PostgreSQL adapter yet.

## Authoritative replay and telemetry overlay

An operator may request authorized operator, team, role, or agent projections. A RunAgent can request only its own `perspective=agent`, with its own `subjectId` and `deliverySemantics=issued|acknowledged`. It cannot request `eligible` or another subject.

The response separates `authoritativeProjection` from `bestEffortTelemetryOverlay`. Events/Receipts define historical knowledge and audit. Trace summaries may be absent, late, or deleted and can never alter authorization, Barriers, scores, or the replay manifest.

## Idempotency, errors, and safe retry

The same stable actor, operation, UUID key, and request returns the original result. Reusing the key with a different request returns `409 IDEMPOTENCY_CONFLICT`. After an ambiguous failure, retry only the identical method, path, actor, body, and key, then reconcile through the smallest safe read.

```json
{
  "error": {
    "code": "TASK_LEASE_STALE",
    "message": "The current Task lease is stale.",
    "traceId": "<request-id>"
  }
}
```

| Status | Meaning                                                                     |
| ------ | --------------------------------------------------------------------------- |
| `401`  | Missing or invalid bearer credential                                        |
| `403`  | Identity, RunAgent binding, scope, or known-resource operation is forbidden |
| `404`  | Resource absent or its existence cannot be disclosed                        |
| `409`  | State, version, lease, base version, Receipt chain, or idempotency conflict |
| `422`  | Schema, range, evidence, or domain-rule failure                             |
| `429`  | Rate limited; honor `Retry-After`                                           |

Error `details` contain only authorized information. Never give an operator token, service-role key, or database credential to a participant.

## Explicit v1 compatibility

Legacy Episode routes remain under `/api/v1`: create/get/observe/observations/submissions/evaluation/feedback/advance/events. Use them only when the assignment or negotiated metadata explicitly selects v1. Never mix a v1 Episode ID, version, Observation evidence, or idempotency key into a v2 Run. The current v1 service is still separate and does not yet translate onto v2 PostgreSQL facts.
