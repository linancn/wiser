---
title: Use WISER data and connect an agent
description: Use an organization account to review public-service data, prepare trial ingestion, and understand external agent connection status.
docType: runbook
scope: repository
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - reviewing WISER data or preparing black-odor water sample trial entry
  - connecting an external MCP client to the public WISER service
whenToUpdate:
  - public entrypoints, data permissions, or OAuth end-to-end acceptance status change
checkPaths:
  - apps/web/src/app/**/oauth/**
  - apps/mcp/src/**
  - supabase/config.toml
lastReviewedAt: 2026-09-26
lastReviewedCommit: 37d60e1cf561bf0f12a97ed34f48ece1a50f29d5
---

## Current availability

| Task                   | Current state                                                                                                        | Start here                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Browse data on the web | The public Portal is reachable; after sign-in, only permitted projects and data appear                               | [Open the WISER Portal](https://wiser.thuenv.tiangong.world:7100/en)                        |
| Access an account      | Existing accounts can sign in with email and password; public self-registration is closed                            | Ask a project administrator for an account or project access                                |
| Ingest data            | Authorized projects can start intake and review checks, approval, and publication progress                           | [View intake tasks](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/ingestions) |
| External AI/MCP        | The public OAuth/MCP protocol entrypoint is available; end-to-end acceptance with a personal client is still pending | Follow the connection steps below and verify project scope                                  |

The web entrypoint, unauthenticated MCP challenge, and registration settings were checked on 2026-09-26. Earlier protocol and permission checks using synthetic ordinary accounts show that these paths can work. They do not replace acceptance with a real personal client or prove compatibility with every third-party client.

## Find and check data

1. [Sign in to the Portal](https://wiser.thuenv.tiangong.world:7100/en) with your existing organization account and confirm the current project.
2. Search the [data catalog](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/catalog) by name, or use [data exploration](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/explore) to review records, maps, and related evidence together. [Data search](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/search) helps find material across sources.
3. Open the pinned version and check its original file, source, license, security level, quality-check scope, and usage limits. Parsed record counts are not independent observation counts; a visible map position is not proof of scientific position accuracy.

If an expected project or resource is absent, confirm the selected project first, then ask a project administrator to check membership, source permission, and data grants. Do not use another person's account or client token to bypass scope.

## Trial ingestion of black-odor water material

Trial intake is limited to material approved for the current project and an account with intake permission. Prepare original files, source descriptions, license basis, and file-integrity information. Then use the [agent setup guide](/en/protocols/agent-setup/) for a bounded intake task. Once you receive a task ID, use the [intake page](https://wiser.thuenv.tiangong.world:7100/en/data-foundation/ingestions) to review checks, human approval, and publication progress.

Upload, parsing, source registration, and formal publication are different states. A trial intake is not a scientific conclusion or professional approval about black-odor water. Before using material, check its time, extent, units, completeness, and applicable scale.

## Connect an external AI/MCP client

The client must support the OAuth 2.1 authorization-code flow with PKCE S256. Set its Streamable HTTP MCP address to https://mcp.wiser.thuenv.tiangong.world:7100/mcp and let the client complete protected-resource discovery, callback registration, and sign-in. See [Data MCP](/en/protocols/data-mcp/) and [Unified Auth](/en/architecture/unified-auth/) for protocol fields.

1. Sign in with your existing WISER account in the browser. Check the requesting client and return address.
2. Explicitly choose one eligible project, query or intake access, the highest data level, and a 15-minute or one-hour term. Deny the request if you do not agree.
3. Return to the original client and make one small catalog read. Check the actual project, data, and action scope. Setup instructions or Skill installation alone do not grant access.
4. Use “AI/MCP connections” in the account menu to disconnect a connection you own. After expiry or when you need more data, disconnect first, then restart from the original client and consent again. Managed projects require separate approval for web and AI/MCP purposes.

Do not paste passwords, authorization codes, or tokens into chat, tool arguments, or logs. If the page says previous consent was not fully cleared, follow its retry action. Data access has stopped, but check the state before reconnecting.

## Personal-client acceptance

End-to-end acceptance with the person's actual client has not yet been recorded. Record the client name, selected project, and non-secret call outcomes. At minimum, verify an allowed read, denial of another project and unapproved actions, explicit denial, expiry, and immediate loss of access after disconnection. Mark that client accepted only after these checks; synthetic-account verification does not substitute for them.
