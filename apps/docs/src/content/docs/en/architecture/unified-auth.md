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
lastReviewedAt: 2026-08-22
lastReviewedCommit: 2fff614988729e9594f436bce759df08f2cf43d5
---

## One identity authority

All WISER systems use the existing Supabase Auth service, JWT signing keys/JWKS, sessions, and PostgreSQL control plane. Data Foundation's independent data-postgres never becomes an authority for users, memberships, roles, or tokens.

A JWT proves the subject, authentication assurance, and session. Dynamic Tenant, Project, Role, and Scope facts are resolved from the Supabase control plane. User-editable `user_metadata` never participates in authorization, and dynamic grants are not fully copied into JWTs because claims change only after token refresh.

The control plane contains `platform` / `platform_private` schemas, automatic user provisioning, Tenant/Project/Membership, Role/Scope/Binding, Delegation, private Credential/Audit/Outbox storage, least-privilege grants, and pgTAP contracts. The default Supabase runtime composes the framework-independent `SupabaseJwtPrincipalResolver`, `getClaims` result verifier, single-query PostgreSQL Membership loader, and delegated credential issue/rotate/revoke path. Missing required facts or configuration fails closed.

Fastify exposes the safe `/api/platform/v1/me` projection and delegated command surface. `WISER_AUTH_MODE=supabase` creates a `supabase-js` client, bounded PostgreSQL pool, prefix-routed JWT/delegated Resolver, and transactional Delegation service in the default process. Production refuses missing Supabase, database, or HMAC key-ring configuration, and process shutdown closes the shared pool.

Web uses `@supabase/ssr` Browser/Server clients and Next.js `proxy.ts`. Proxy calls `getClaims()` before producing a response, writes refreshed cookies to both request and response, and sets `private, no-store`. The `/[locale]` Portal, sign-in, and Auth transport routes allow anonymous access. Other localized product routes without verified authenticated claims preserve their destination and redirect to locale sign-in. Bilingual password login, PKCE callback, POST-only local sign-out, and the shared Shell use the same session boundary. Every continuation target is normalized to the active locale and rejected if it leaves the WISER origin or re-enters an Auth endpoint; every Auth response is non-cacheable.

Delegated credentials strictly parse `wdc1.<key-id>.<secret>`, generate independent 128-bit locators and 256-bit secrets with Node's secure random source, and store only a domain-separated HMAC-SHA-256. The JSON key-ring configuration requires canonical unpadded base64url keys of at least 256 bits, names one active key for issuance, retains previous keys for verification during rotation, and fails closed without echoing secret configuration. The default process composes the delegated principal Resolver, single-query PostgreSQL adapter, and transactional create/issue/rotate/revoke service.

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
- Roles and scopes are separate; scopes use `platform.*`, `excon.*`, and `data.*` namespaces. Every Role also has a fail-closed L0-L3 security ceiling, and the live authorization context uses the highest ceiling among the caller's active bindings.
- Every exposed table enables RLS with subject, Tenant, Project, and ownership predicates. `TO authenticated` alone is not authorization.
- Privileged functions live in an unexposed schema, set a safe `search_path`, and revoke default `PUBLIC EXECUTE`.

## Platform HTTP entrypoints

| Method | Path                                                             | Purpose                                                                     |
| ------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET`  | `/api/platform/v1/me`                                            | Return safe Actor, Role, Scope, security-ceiling, and authz-version context |
| `POST` | `/api/platform/v1/delegations`                                   | Create a bounded Delegation                                                 |
| `GET`  | `/api/platform/v1/delegations/{delegationId}`                    | Read safe metadata                                                          |
| `POST` | `/api/platform/v1/delegations/{delegationId}/credentials`        | Issue plaintext once                                                        |
| `POST` | `/api/platform/v1/delegations/{delegationId}/credentials:rotate` | Rotate and return new plaintext once                                        |
| `POST` | `/api/platform/v1/delegations/{delegationId}:revoke`             | Revoke a Delegation                                                         |
| `POST` | `/api/platform/v1/credentials/{credentialId}:revoke`             | Revoke one credential                                                       |

`/me` and delegation routes require Bearer, Tenant, Project, and Purpose. Every write requires a UUID `Idempotency-Key`; Delegation commands also require a verified Supabase human with `platform.delegation.manage`. Responses are `private, no-store`, and issue/rotate plaintext is unrecoverable.

## Request processing

```text
Bearer credential
→ Supabase JWT / delegated / local Resolver
→ verify signature, issuer, audience, expiry, session or delegation
→ query Supabase Membership/Role/Scope
→ PlatformPrincipal + AuthorizedContext (including maxSecurityLevel)
→ AuthorizationService(capability, purpose, resource, security level, fields, volume)
→ system Handler
→ append-only audit
```

A failed JWT never falls back to a local token, preventing token confusion. Local tokens are available only in explicit development/test modes; production refuses to start when local authentication is configured.

## Web sessions

Web uses Supabase SSR cookies. Server Components forward the current access token, and Fastify verifies and authorizes it again. The browser receives only the Supabase URL and publishable key; service-role and secret keys, database URLs, object-store secrets, and internal projection credentials never enter the client.

The public Portal shows platform and system descriptions only; it reads no project, Data, or exercise facts. Proxy's sign-in gate establishes only the minimum “valid Session exists” boundary and never replaces Data Capability, EXCON operator, or resource authorization on the server. `WISER_AUTH_MODE=off` is an explicit local reference-preview mode and is rejected in production.

The Shell derives its user indicator only from a freshly verified authenticated claim set. It never renders user-editable metadata as a trusted role or administrator label. Invalid, expired, privileged, unavailable, or malformed claims produce the same anonymous/fail-closed state.

`WISER_WEB_OPERATOR_TOKEN` is a server-side operator/service identity, not an interactive user session. Platform-diagnostic service identities need explicit scopes and remain server-side.

## Agent and MCP delegation

A verified Supabase human with `platform.delegation.manage` calls the authorized API to issue a short-lived delegated credential for one Agent, Run, and Project. Requested scopes are intersected with the delegator's current scopes; purpose, maximum security level, and expiry are fixed in the Delegation.

- Delegation depth is limited to one.
- Plaintext credentials are returned once; storage uses a server-peppered HMAC.
- Delegated bearer tokens use the strict `wdc1.<key-id>.<secret>` envelope. The public key id locates one private row; `hmac_key_id` selects a versioned server key without exposing it.
- Verification locates by public key id, recomputes the HMAC in process, and uses a fixed-length timing-safe comparison; unknown key ids, malformed tokens, and mismatches return the same failure surface.
- Delegations have an optimistic version. Revocation and rotation keep old Credential rows as security facts; Tenant, Project, or Delegation deletion cannot cascade through that history.
- Revoking delegator membership, Project, Agent, delegation, or credential rejects the next request.
- MCP tool arguments, Messages, Artifacts, logs, and traces never contain credentials.
- Platform delegated credentials live in `platform_private.delegated_credentials` and use the `wdc1.` envelope. EXCON separately stores opaque capability tokens in `excon_private.run_agent_credentials`, directly binding protocol scopes to `runAgentId/runId`. They are neither the same row nor the same token type.

Telemetry Ingress issues no new identity. It verifies the HMAC of that separate EXCON RunAgent capability token and requires the protocol-level `telemetry:write` scope, an unexpired/unrevoked credential, a valid RunAgent, and active AgentVersion/AgentIdentity lifecycle. This verifier does **not** resolve the Platform `wdc1.` Delegation, Tenant/Project memberships, or their revocation state, so Platform membership revocation alone does not invalidate the token. The repository has no issuance/rotation/revocation API or CLI for this token. Production deployment must supply and test a trusted lifecycle workflow; otherwise database mode is not operationally complete.

The Fastify `platform.delegation` module defines the HTTP command boundary for create, metadata read, issue, rotate, and revoke. It accepts only verified Supabase humans with `platform.delegation.manage`, UUID idempotency keys, a maximum one-hour TTL, known delegated scopes, and a ceiling no higher than the caller's live ceiling. Plaintext appears only in successful issue/rotate responses and every response is `private, no-store`. `PostgresPlatformDelegationService` revalidates the Supabase Session and live memberships inside each transaction, takes idempotency and aggregate locks, clips credentials to 15 minutes and the Delegation expiry, preserves one active credential, and writes Audit plus Control Outbox atomically. Same-hash command replay is safe; issue/rotate replay returns `SECRET_NOT_RECOVERABLE` rather than storing recoverable plaintext. Audit, Outbox, and errors contain neither token nor HMAC.

Delegated bearer resolution parses the envelope before any database lookup, loads one private record by its public key id, verifies the HMAC in Node with a fixed-length timing-safe comparison, and only then trusts control facts. Every request rechecks both actors, both Tenant/Project memberships, the Tenant, Project, delegation and credential lifecycle, Purpose, and expiry. Effective scopes are the sorted intersection of delegation scopes, the delegator's current live scopes, and the injected known-scope registry; the effective security ceiling is the lower of the delegation and the delegator's current ceiling. No positive authorization cache is used.

The Agent EXCON v2 participant authenticator and Data Capability Handler reuse the same prefix-routed Platform Resolver. The complete stack injects fixed EXCON Tenant/Project/Purpose and requires delegated `runAgentIds`/scopes to match the resource. Data REST, GraphQL, MCP, and the Web server DAL all resolve live context from the same Supabase JWT or `wdc1.` credential. The EXCON command journal and data-postgres retain only scoped subject references/audit and never create another identity system.

## Cross-database Data Foundation references

data-postgres stores only Tenant, Project, and Actor UUIDs plus a policy version. It never copies Supabase sessions or secrets. A read-only `control_ref` projection may support background consistency checks but can never widen access. Before query results, downloads, exports, reviews, or publication, the API authorizes again against the Supabase authority context.

## Required negative tests

- Bad signature, issuer, audience, expiry, not-before, unknown key, or session.
- Cross-Tenant/Project substitution of IDs, headers, or resource references.
- Revoked membership, delegation, credential, Agent, or Project.
- Excess scope, purpose, security level, fields, or export volume.
- RLS isolation for anon, authenticated, API, worker, and migration roles.
- No server secret in browsers, MCP, logs, or telemetry.
