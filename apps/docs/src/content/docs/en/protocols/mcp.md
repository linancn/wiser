---
title: MCP integration
description: Expose stable HTTP operations as discoverable, constrained MCP Tools and Resources.
---

## Adapter, not a second backend

The MCP server calls the public HTTP API. It does not duplicate authorization, state, or adjudication and does not bypass the participant protocol with a database service role.

Use the stable `@modelcontextprotocol/sdk` v1 line. Remote deployments use Streamable HTTP; locally spawned servers use stdio. Do not add a new legacy HTTP+SSE implementation.

## Tools

| Tool                     | HTTP operation         | Behavior                  |
| ------------------------ | ---------------------- | ------------------------- |
| `excon_start_episode`    | `POST /episodes`       | Idempotent write          |
| `excon_get_observation`  | `GET .../observations` | Read-only                 |
| `excon_submit_result`    | `POST .../submissions` | Idempotent write          |
| `excon_get_evaluation`   | `GET .../evaluation`   | Read-only                 |
| `excon_get_feedback`     | `GET .../feedback`     | Read-only                 |
| `excon_advance_episode`  | `POST .../advance`     | Authorized write          |
| `excon_finalize_episode` | `POST .../finalize`    | Explicit finalizing write |

Input and `structuredContent` derive from shared Zod schemas. Text content is a short human summary and must not become a second machine format.

## Resources and credentials

Read-only URIs may include `excon://episodes/{episodeId}` and `excon://submissions/{submissionId}/evaluation`. Hidden Outcomes, full rules, and unreleased Injects are never Resources.

Remote MCP uses HTTP-equivalent OAuth/token scopes. stdio reads a short-lived token from its environment; credentials never enter Tool arguments or model context.

Map HTTP failures to `isError: true` with the stable code, safe details, and trace ID. Contract tests reuse HTTP fixtures and verify schemas, structured results, authorization-safe errors, idempotency, and truthful Tool annotations.

Codex may participate through these Tools or maintain the codebase as a development agent. Those identities and credentials are separate from the model-evaluator role.
