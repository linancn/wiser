---
title: Unified identity and authorization
description: How one Supabase Auth installation serves WISER Platform, Agent EXCON, and Data Foundation identities, tenants, projects, and delegated credentials.
docType: security-guide
scope: wiser-auth
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing login, JWTs, sessions, tenants, projects, roles, scopes, or agent delegation
whenToUpdate:
  - when identity authority, membership, RLS, credentials, or revocation semantics change
checkPaths:
  - supabase/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/telemetry-ingress/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: a395ed8aef5615b780ebbc39aa1f678e617acfda
---

## One identity authority

All WISER systems use the existing Supabase Auth service, JWT signing keys/JWKS, sessions, and PostgreSQL control plane. Data Foundation's independent data-postgres never becomes an authority for users, memberships, roles, or tokens.

A JWT proves the subject, authentication assurance, and session. Dynamic Tenant, Project, Role, and Scope facts are resolved from the Supabase control plane. User-editable `user_metadata` never participates in authorization, and dynamic grants are not fully copied into JWTs because claims change only after token refresh.

## Control-plane model

```text
platform.actors
platform.user_profiles
platform.tenants
platform.tenant_memberships
platform.projects
platform.project_memberships
platform.roles
platform.role_scopes
platform.role_bindings
platform.delegations

platform_private.delegated_credentials
platform_private.authorization_audit_events
platform_private.control_outbox
```

- Actor represents a human, agent, or service; human actors reference `auth.users.id`.
- Tenant is the top-level isolation boundary; Project is the resource-ownership boundary.
- Tenant membership does not automatically grant access to every Project.
- Roles and scopes are separate; scopes use `platform.*`, `excon.*`, and `data.*` namespaces.
- Every exposed table enables RLS with subject, Tenant, Project, and ownership predicates. `TO authenticated` alone is not authorization.
- Privileged functions live in an unexposed schema, set a safe `search_path`, and revoke default `PUBLIC EXECUTE`.

## Request processing

```text
Bearer credential
→ Supabase JWT / delegated / local Resolver
→ verify signature, issuer, audience, expiry, session or delegation
→ query Supabase Membership/Role/Scope
→ PlatformPrincipal + AuthorizedContext
→ AuthorizationService(capability, purpose, resource, security level, fields, volume)
→ system Handler
→ append-only audit
```

A failed JWT never falls back to a local token, preventing token confusion. Local tokens are available only in explicit development/test modes; production refuses to start when local authentication is configured.

## Web sessions

Web uses Supabase SSR cookies. Server Components forward the current access token, and Fastify verifies and authorizes it again. The browser receives only the Supabase URL and publishable key; service-role and secret keys, database URLs, object-store secrets, and internal projection credentials never enter the client.

`WISER_WEB_OPERATOR_TOKEN` no longer represents an interactive user. Platform-diagnostic service identities need explicit scopes and remain server-side.

## Agent and MCP delegation

A user or service calls an authorized API to issue a short-lived delegated credential for one Agent, Run, and Project. Requested scopes are intersected with the delegator's current scopes; purpose, maximum security level, and expiry are fixed in the Delegation.

- Delegation depth is one in the first release.
- Plaintext credentials are returned once; storage uses a server-peppered HMAC.
- Revoking delegator membership, Project, Agent, delegation, or credential rejects the next request.
- MCP tool arguments, Messages, Artifacts, logs, and traces never contain credentials.
- EXCON private data retains only the binding between the general credential and `runAgentId/runId`.

## Cross-database Data Foundation references

data-postgres stores only Tenant, Project, and Actor UUIDs plus a policy version. It never copies Supabase sessions or secrets. A read-only `control_ref` projection may support background consistency checks but can never widen access. Before query results, downloads, exports, reviews, or publication, the API authorizes again against the Supabase authority context.

## Required negative tests

- Bad signature, issuer, audience, expiry, not-before, unknown key, or session.
- Cross-Tenant/Project substitution of IDs, headers, or resource references.
- Revoked membership, delegation, credential, Agent, or Project.
- Excess scope, purpose, security level, fields, or export volume.
- RLS isolation for anon, authenticated, API, worker, and migration roles.
- No server secret in browsers, MCP, logs, or telemetry.
