---
title: Agent setup and Skill delivery
description: Copy a setup prompt, verify the WISER Skill release, and connect through the deployment's advertised governed transport.
docType: protocol-reference
scope: platform-agent-setup
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when connecting an AI agent to WISER or publishing its Skill release
whenToUpdate:
  - when setup URLs, release files, integrity checks or connection instructions change
checkPaths:
  - apps/api/src/platform/agent-setup.ts
  - skills/wiser-data-foundation/**
  - apps/web/src/components/agent-setup*
  - apps/docs/src/components/agent-setup*
lastReviewedAt: 2026-09-08
lastReviewedCommit: cee9c51ac26e77bd078edc3af41cfb6ca0de611d
---

The Portal and documentation pages provide **Connect your agent to WISER**. Copy its instructions into your AI assistant. The button copies a public setup URL; it grants no account or project access. A denied clipboard permission exposes the same instructions in a selectable text field.

## Public delivery contract

The shared API serves these unauthenticated resources:

| Resource                                 | Purpose                                                                                      |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/agent-setup/prompt.md`                 | Current agent-readable setup instructions                                                    |
| `/agent-setup/manifest.json`             | `wiser.agent-setup.v1`, API and optional MCP endpoints, content-pinned release and file list |
| `/agent-setup/releases/{release}/{path}` | An allowlisted file from that exact release                                                  |

The manifest includes `SKILL.md`, the agent metadata, protocol/governance/examples/bundle references, and both Python bundle helpers. Each file has a relative path, public URL, byte count and SHA-256. The release identifier hashes the ordered file descriptors. A release URL serves only its exact bytes with immutable caching; an unknown release or non-allowlisted file returns `404`. Source bundles, environment files, credentials and test fixtures are never included. Install all listed files while retaining their relative paths and checking size and hash.

The running process advertises its current release; it does not promise retention of older releases across deployments. If a deployment changes during installation and an old file returns `404`, fetch the current manifest and restart verification. Never mix files from different releases.

## Connection and verification

The prompt detects the current client and uses its supported project Skill location, preserving unrelated configuration and modified local Skills. It discovers the API's current Capabilities before any business operation. Skill installation and successful account connection are separate outcomes.

When configured, `mcpResource` advertises the deployment's native OAuth MCP transport. The client follows protected-resource discovery and PKCE S256, then uses the WISER consent flow to choose a project and bounded access. `wiser_connection` verifies the resulting identity and scope. Query access is the default; ingestion access is requested only for an ingestion assignment. Existing [Platform Auth](/en/architecture/unified-auth/) and [Data MCP](/en/protocols/data-mcp/) contracts govern the identity exchange.

If the manifest has no `mcpResource`, the prompt explicitly uses the Skill's HTTP workflow with an identity supplied through a trusted WISER Auth assignment. It does not invent a native MCP connection. A client that lacks the required transport must report that limitation. Neither the setup prompt nor the clipboard contains a password, bearer or tenant-specific secret.

Finish setup with a bounded catalog read and report the observed result, installed release and verified project context. Do not perform ingestion just to prove installation. Research bundles subsequently follow the bundled `references/water-bundle.md`: full reconciliation, scoped registration, explicit review, immutable publication and asset hash readback. Registration integrity is distinct from analytical quality or dataset completeness.

## Deployment

Set `WISER_AGENT_SETUP_URL` for Web and Docs to the public API's `/agent-setup/prompt.md`. Local development defaults to `http://127.0.0.1:3101/agent-setup/prompt.md`. Production Docs are prerendered, so supply the intended public URL during the Docs build as well as local runtime configuration.

The API derives its public file URLs from `DATA_PUBLIC_API_ORIGIN` and advertises `WISER_AGENT_MCP_RESOURCE` only when configured. Use HTTPS public URLs outside loopback. Internal Docker hostnames, userinfo, query credentials and fragments are rejected. Advertising an MCP URL does not start or authorize that gateway: configure its OAuth mode and matching issuer/resource according to the MCP protocol, and verify its metadata and actual connection before announcing it as available.
