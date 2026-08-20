---
title: MCP integration
description: Expose stable HTTP operations as discoverable, constrained MCP Tools and Resources.
---

## Adapter, not a second backend

The MCP server calls the public HTTP API. It does not duplicate authorization, state, or adjudication and does not bypass the participant protocol with a database service role.

The tool table on this page describes the implemented v1 single-agent compatibility slice. v2 keeps agent actions out of the Web and expands the general Skill/MCP loop to assignments, receipt sync, Task claims, Messages/Artifacts, Task submissions, endorsements, and layered Feedback. See [multi-agent control and observability](/en/architecture/multi-agent-observability/).

Use the stable `@modelcontextprotocol/sdk` v1 line. The first slice ships a locally spawned stdio server only. A future remote deployment uses Streamable HTTP; do not add a legacy HTTP+SSE implementation.

## Tools

| Tool                           | HTTP operation         | Behavior                            |
| ------------------------------ | ---------------------- | ----------------------------------- |
| `excon_start_episode`          | `POST /episodes`       | Idempotent non-destructive write    |
| `excon_get_episode`            | `GET /episodes/{id}`   | Read-only state reconciliation      |
| `excon_observe`                | `POST .../observe`     | Idempotent access-recording write   |
| `excon_list_observations`      | `GET .../observations` | Read-only full evidence recovery    |
| `excon_submit_allocation_plan` | `POST .../submissions` | Idempotent write                    |
| `excon_get_evaluation`         | `GET .../evaluation`   | Read-only evaluation reconciliation |
| `excon_get_feedback`           | `GET .../feedback`     | Read-only                           |
| `excon_advance`                | `POST .../advance`     | Idempotent irreversible advance     |
| `excon_get_events`             | `GET .../events`       | Read-only paginated trace           |

Input and `structuredContent` derive from shared Zod schemas. Text content is a short human summary and must not become a second machine format.

## Resources and credentials

The first slice exposes one bilingual read-only Resource: `excon://scenarios/jing-jin-ji-yongding-river`. Episode, evaluation, and trace data remain behind authenticated HTTP operations and response links. Hidden Outcomes, full private rules, and unreleased Injects are never Resources.

Remote MCP uses HTTP-equivalent OAuth/token scopes. stdio reads a short-lived token from its environment; credentials never enter Tool arguments or model context.

Map HTTP failures to `isError: true` with the stable code, safe details, and trace ID. Contract tests reuse HTTP fixtures and verify schemas, structured results, authorization-safe errors, idempotency, and truthful Tool annotations.

Codex may participate through these Tools or maintain the codebase as a development agent. Those identities and credentials are separate from the model-evaluator role.
