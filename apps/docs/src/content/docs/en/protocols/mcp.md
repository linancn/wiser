---
title: MCP integration
description: Participate through 18 implemented v2 Tools over local stdio or authenticated stateless Streamable HTTP.
docType: protocol-reference
scope: mcp-adapter
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when participating through MCP or changing MCP tools
whenToUpdate:
  - when tools, HTTP mappings, credentials, or version selection changes
checkPaths:
  - apps/mcp/**
  - apps/api/**
  - skills/agent-excon/**
lastReviewedAt: 2026-08-22
lastReviewedCommit: 76f3f6d4967c0f7fc13b06ca1480244121a90272
---

## An HTTP adapter

The MCP server calls only the public HTTP API. It does not duplicate state machines, authorization, Receipts, or adjudication; it never connects directly to PostgreSQL or holds a service-role credential. The default is multi-scenario, multi-agent **v2** with `/api/v2/` as the API base.

The server uses the stable v1 line of `@modelcontextprotocol/sdk`. Local clients use stdio; the Compose-facing entrypoint uses authenticated, stateless Streamable HTTP. Inputs are strict Zod schemas. Successful calls mirror compact `MACHINE_DATA` in Chinese-first `content` and preserve the same machine-readable `structuredContent`, including for Agent clients that display only text.

## WISER module composition

Agent EXCON, Data Foundation, and future systems reuse one MCP Server. Each system statically registers Tools and Resources through a `WiserMcpModule`; module ids are namespaced and globally unique, and duplicates fail before a transport connects. Registration composes only the protocol surface, while every business call continues through the HTTP API.

The Data Foundation module registers 22 Tools and five governed Resources when all five Data API/scope environment values are present. Partial configuration fails closed; no Data configuration runs EXCON alone. Data Tools safely preserve downstream `401 → NOT_AUTHENTICATED` and `403 → NOT_AUTHORIZED`; successful Operation results expose exact `operation://<uuid>` at top-level `structuredContent.resource`, and Evidence/STAC Resources use real HTTP, RLS, and audit reads. See [Data MCP](/en/protocols/data-mcp/) for the two bearer layers, upload/Operation flow, and response bounds.

## Configuration

Start only after a trusted bootstrap provides the `runId`, `runAgentId`, and short-lived token bound to that instance:

```bash
export AGENT_EXCON_API_KEY=<short-lived-run-agent-token>
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v2/

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start
```

Never place the token in Tool arguments, Messages, Artifacts, Submissions, logs, telemetry, or Git. Starting MCP neither registers a RunAgent nor converts an operator credential into a participant identity.

### Streamable HTTP entrypoint

The shared Compose profile runs a second entrypoint at `POST /mcp`. It requires a boundary-only bearer and still uses the short-lived `AGENT_EXCON_API_KEY` for downstream business requests:

```bash
export DATA_MCP_BEARER_TOKEN=<random-secret-at-least-16-characters>
export DATA_MCP_HOST=127.0.0.1 # optional; default 0.0.0.0
export DATA_MCP_PORT=3100      # optional

pnpm --filter @wiser/mcp build
pnpm --filter @wiser/mcp start:http
```

`GET /health/live` and `GET /health/ready` are unauthenticated, non-cacheable probes. Every `/mcp` request gets a fresh MCP server and transport; this stateless boundary does not issue or resume a session. A valid `Authorization: Bearer …` header is mandatory, tokens in query parameters are not accepted, and graceful shutdown first makes readiness unhealthy while draining in-flight requests.

## Implemented v2 Tools

This table matches `apps/mcp/src/server.ts` and the current Fastify routes. HTTP operations are relative to `/api/v2/`.

| MCP Tool                         | HTTP operation                                 | Actual effect                                                           |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------- |
| `excon_get_assignment`           | `GET runs/{runId}/me`                          | Reconcile the credential-bound RunAgent, role, and sync cursor          |
| `excon_sync`                     | `POST runs/{runId}/sync`                       | Issue new resources and optionally acknowledge the prior Receipt head   |
| `excon_wait_and_sync`            | `POST runs/{runId}/sync`                       | Wait on wall time, then perform one normal sync without virtual advance |
| `excon_list_tasks`               | `GET runs/{runId}/tasks`                       | Recover issued Tasks                                                    |
| `excon_list_messages`            | `GET runs/{runId}/messages`                    | Recover issued Messages                                                 |
| `excon_list_artifacts`           | `GET runs/{runId}/artifacts`                   | Recover issued Artifact grants                                          |
| `excon_list_submissions`         | `GET runs/{runId}/submissions`                 | Recover exact issued immutable Submission revisions                     |
| `excon_claim_task`               | `POST tasks/{taskId}:claim`                    | Claim a fenced Task lease; only this Tool returns its opaque token      |
| `excon_begin_task`               | `POST tasks/{taskId}:begin`                    | Begin under the current lease                                           |
| `excon_heartbeat_task`           | `POST tasks/{taskId}:heartbeat`                | Request a bounded lease renewal                                         |
| `excon_release_task`             | `POST tasks/{taskId}:release`                  | Release the lease and invalidate its old token                          |
| `excon_submit_task_result`       | `POST tasks/{taskId}/submissions`              | Create an immutable Receipt/ArtifactVersion-backed result               |
| `excon_post_message`             | `POST runs/{runId}/messages`                   | Send an inform/request/response or ArtifactVersion handoff              |
| `excon_publish_artifact`         | `POST runs/{runId}/artifacts`                  | Publish an Artifact and immutable first version                         |
| `excon_publish_artifact_version` | `POST artifacts/{artifactId}/versions`         | Append from an exact `baseVersionId`                                    |
| `excon_endorse_submission`       | `POST submissions/{submissionId}/endorsements` | Consume a matching ActionGrant for the exact revision                   |
| `excon_get_feedback`             | `GET runs/{runId}/feedback`                    | Recover issued layered Feedback/ActionGrants                            |
| `excon_get_replay_cursor`        | `GET runs/{runId}/replay`                      | Read only this agent's `issued`/`acknowledged` perspective              |

`excon_list_submissions` recovers only exact immutable revisions receipted to the current RunAgent through `excon_sync`. It cannot reveal unissued Submissions or another agent's view; recover and review the target revision with this Tool before endorsement.

## Recommended sequence

1. Call `excon_get_assignment` and require its RunAgent/Run/role to match the trusted bootstrap.
2. Call `excon_sync` from the durable `afterReceiptSeq`. After validating and processing a non-empty batch, acknowledge its exact `throughReceiptSeq` and `receiptHeadHash` on the next sync.
3. Use `excon_list_tasks` only to recover issued Tasks, then claim with the Task's own `lockVersion`.
4. Preserve the claim's `claimEpoch`, `leaseToken`, and expiry locally. Begin, then heartbeat bounded long work before expiry.
5. Use `request` for an explicit question, a causal `response` that references a receipted parent request, and `handoff` for a pinned ArtifactVersion transfer. A successful write is not recipient knowledge until their own sync issues a Receipt; Receipt acknowledgement still does not mean understanding or agreement.
6. `excon_submit_task_result` cites at least one verified own Receipt or authorized ArtifactVersion.
7. Receive the Submission Receipt through `excon_sync`, then recover and review the exact immutable revision with `excon_list_submissions`. Endorse only after receiving a matching ActionGrant.
8. Use `excon_wait_and_sync` for bounded waits on Feedback or downstream Barrier work. Participants have no Run-clock advance or Barrier-release Tool.
9. Handoff through `excon_get_replay_cursor`, keeping authoritative Event/Receipt facts separate from best-effort telemetry gaps.

`/sync` is the only operation that issues a new Task, Message, Artifact grant, Submission, or Feedback. The five recovery Tools never turn eligible content into issued content.

## Safe retry and response bounds

- Every write Tool requires a UUID `idempotencyKey`. After an ambiguous failure, retry only the identical actor, Tool/path, body, and key.
- The caller keeps Task lease tokens in local state; MCP does not persist them for the caller.
- API failures become `isError: true` results with a stable `code`, safe message, next action, and optional trace ID. API `details` are not forwarded to the agent.
- When Artifact/Message snapshots accumulate, reduce `sync maxItems` to about 8 and follow the contiguous returned cursor while `hasMore=true` to avoid `MCP_RESPONSE_TOO_LARGE`.
- A complete MCP response over 32,000 characters returns `MCP_RESPONSE_TOO_LARGE`. Narrow `sync.maxItems` or the replay cursor; never treat a truncated payload as complete fact.
- The RunAgent replay Tool does not expose operator/team/role/eligible perspectives.

The local v2 Lab may explicitly use the memory profile. The complete stack and production use an append-only PostgreSQL command journal: intent/outcome rows, canonical hashes, and generation tapes for all 19 v2 mutations replay deterministically after restart. A single-writer advisory lock, non-superuser RLS, lease-HMAC secret references, and replay-drift checks fail closed. MCP remains an HTTP adapter and never reads the journal.

## Resource

The bilingual read-only scenario Resource is:

```text
excon://scenarios/jing-jin-ji-yongding-river
```

It describes the fact-anchored synthetic Jing-Jin-Ji Yongding River multi-agent exercise. Runs, Receipts, Feedback, and replay remain behind authenticated Tools. Hidden Outcomes, full evaluation rules, unreleased Injects, and another agent's private content are never Resources.

## Explicit v1 compatibility

v1 Tools are not registered automatically. Set both values only for an explicitly assigned legacy Episode:

```bash
export AGENT_EXCON_PROTOCOL_VERSION=v1
export AGENT_EXCON_API_URL=http://127.0.0.1:3001/api/v1/
```

This mode registers nine legacy Tools: `excon_start_episode`, `excon_get_episode`, `excon_observe`, `excon_list_observations`, `excon_submit_allocation_plan`, `excon_get_evaluation`, `excon_get_feedback`, `excon_advance`, and `excon_get_events`. Never carry a v1 Episode, Observation, version, or idempotency key into a v2 Run.
