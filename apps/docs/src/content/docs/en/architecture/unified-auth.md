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
lastReviewedAt: 2026-09-26
lastReviewedCommit: ce7c39fbcc4aebc5bca1f67ee80634b7ce544c4d
---

## One identity authority

All WISER systems use the existing Supabase Auth service, JWT signing keys/JWKS, sessions, and PostgreSQL control plane. Data Foundation's independent data-postgres never becomes an authority for users, memberships, roles, or tokens.

A JWT proves the subject, authentication assurance, and session. Dynamic Tenant, Project, Role, and Scope facts are resolved from the Supabase control plane. User-editable `user_metadata` never participates in authorization, and dynamic grants are not fully copied into JWTs because claims change only after token refresh.

The control plane contains `platform` / `platform_private` schemas, automatic user provisioning, Tenant/Project/Membership, Role/Scope/Binding, Delegation, private Credential/Audit/Outbox storage, least-privilege grants, and pgTAP contracts. The default Supabase runtime composes the framework-independent `SupabaseJwtPrincipalResolver`, `getClaims` result verifier, single-query PostgreSQL Membership loader, and delegated credential issue/rotate/revoke path. Missing required facts or configuration fails closed.

Fastify exposes the safe `/api/platform/v1/me` projection and delegated command surface. `WISER_AUTH_MODE=supabase` creates a `supabase-js` client, bounded PostgreSQL pool, prefix-routed JWT/delegated Resolver, and transactional Delegation service in the default process. Production refuses missing Supabase, database, or HMAC key-ring configuration, and process shutdown closes the shared pool.

Web uses `@supabase/ssr` Browser/Server clients and Next.js `proxy.ts`. Proxy calls `getClaims()` before producing a response, writes refreshed cookies to both request and response, and sets `private, no-store`. The `/[locale]` Portal, sign-in, and Auth transport routes allow anonymous access. Other localized product routes without verified authenticated claims preserve their destination and redirect to locale sign-in. Bilingual password login, PKCE callback, POST-only local sign-out, and the shared Shell use the same session boundary. Every continuation target is normalized to the active locale and rejected if it leaves the WISER origin or re-enters an Auth endpoint; every Auth response is non-cacheable.

Delegated credentials strictly parse `wdc1.<key-id>.<secret>`, generate independent 128-bit locators and 256-bit secrets with Node's secure random source, and store only a domain-separated HMAC-SHA-256. The JSON key-ring configuration requires canonical unpadded base64url keys of at least 256 bits, names one active key for issuance, retains previous keys for verification during rotation, and fails closed without echoing secret configuration. The default process composes the delegated principal Resolver, single-query PostgreSQL adapter, and transactional create/issue/rotate/revoke service.

## Invited readers and self-password setup

Invitations use the existing Supabase Auth authority. The Web invitation landing page `GET /[locale]/auth/invite?token_hash=...` is read-only: the user explicitly submits its confirmation form to `POST /[locale]/auth/accept`. That handler accepts only an invite OTP, requires the exact same Origin, verifies the new authenticated claims, and redirects without the hash to `/[locale]/account/password`. Merely scanning or opening the landing link does not consume the invite. Expired/replayed links expose a stable recovery message rather than upstream errors.

Configure the Supabase **invite email template**, under the existing administrator's authority, to link to the deployed HTTPS WISER `/zh-CN/auth/invite?token_hash={{ .TokenHash }}` (or `/en/auth/invite`). Do not send the default implicit fragment link to the PKCE-only callback: the inviting administrator and recipient do not share a PKCE verifier. Keep the existing PKCE callback for its existing login flow. Deployment must redact `token_hash` and other authentication query values from access logs, analytics and error reports; never attach real invitation URLs to support tickets. Invitation and password pages use `strict-origin`: native form POSTs retain a verifiable Origin while Referer never includes the path or token. Acceptance/password responses remain no-referrer and non-cacheable. A no-referrer document would make native form Origin null; do not weaken the same-origin guard to work around it. The single-use email link remains a credential until consumed or expired.

The signed-in user can open the password page from the account control. `POST /[locale]/auth/password` requires the same Origin, verified claims and a matching live `getUser()` result, validates matching 12–4096 character passwords, and calls only Supabase `updateUser({password})`. Provider password/security requirements still apply. Success signs out the local session and returns to sign-in; this does not claim to revoke other devices. No service-role key, member/role operation, public registration or administrative account-management interface is involved. Password setup never grants a Tenant, Project or data permission. Administrators manage those separately through the existing control plane.

The canonical invite template is served by Web at `/auth-email-templates/invite.html`. The Supabase CLI reads the same file through `[auth.email.template.invite]`; Compose-managed GoTrue must set `GOTRUE_MAILER_TEMPLATES_INVITE` to the deployed HTTPS template URL. A filesystem mount alone is insufficient because GoTrue fetches custom templates over HTTP. Verify the returned body and the generated invitation before delivery; template-fetch failure can fall back to the default email.

Local acceptance uses disposable synthetic identities with no real invitation mail. Real SMTP delivery, the deployed email template, proxy Origin handling, target memberships and the recipient's own experience require separate authorized deployment checks.

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
platform_private.agent_connections
platform_private.agent_exchange_credentials
```

Agent connection records bind one human and OAuth client to one existing `agent-data` Delegation and an exact MCP resource URL. Exchanged credentials retain an immutable OAuth Session binding and cannot outlive the OAuth token. The optional Supabase access-token hook preserves direct login claims, rejects unapproved OAuth clients, and binds approved claims to that resource and Delegation. The hook is invoked only by Supabase Auth; its presence does not enable the OAuth runtime. Ordinary human JWT resolution rejects tokens carrying `client_id`.

`createSupabaseAgentClaimsVerifier` is the separate verifier for these signed claims. It requires exact configured issuer and single resource audience, authenticated role, valid user/session/client/Delegation IDs, and a future integer expiry. It never derives a Delegation from user metadata. Live connection and Session authorization remains the caller's responsibility after claim verification.

`PostgresAgentConnectionService` provides request inspection, project consent, connection listing/revocation, and credential exchange. Consent requires a live direct human Session, `platform.delegation.manage`, and catalog access to the chosen Project. The query mode grants only available read scopes; ingestion additionally requires an explicit choice and current `data.ingestion.write`. Publication is excluded. Security level defaults to internal, cannot exceed the caller's ceiling, and the grant lasts 60–3600 seconds. The browser must first associate the OAuth authorization request with the human through Supabase before the service commits consent.

Consent creates a platform Agent, expiring memberships, and one bounded Delegation in one control-plane transaction. Reconsent revokes the previous Delegation. Exchange verifies the current connection, OAuth client, consent and Session, then issues a credential for at most 60 seconds, also capped by OAuth and Delegation expiry. `agent_exchange` credentials allow concurrent requests; ordinary `delegated` credentials retain the single-active constraint. Credential kind and OAuth binding are immutable, a deferred constraint requires the binding at commit, and every delegated API resolution rechecks the bound Session, consent, client and current Delegation. Mutations use idempotency locks plus atomic Audit/Outbox; exchange replay cannot recover plaintext.

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

Agent HTTP routes are enabled when the API receives both `WISER_AGENT_MCP_RESOURCE` (the exact public `/mcp` URL) and `WISER_AGENT_AUTH_ISSUER` (the public Supabase `/auth/v1` issuer). Both require HTTPS except on loopback. The internal Supabase transport URL remains independent of the public issuer. Partial configuration fails startup.

| Method | Path                                                       | Authentication and result                                                    |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`  | `/api/platform/v1/agent-authorizations/{authorizationId}`  | Direct human Session; OAuth client details and eligible projects             |
| `POST` | `/api/platform/v1/agent-connections`                       | Direct human Session; bounded project consent                                |
| `GET`  | `/api/platform/v1/agent-connections`                       | Direct human Session; own safe connection metadata                           |
| `POST` | `/api/platform/v1/agent-connections/{connectionId}/revoke` | Direct human Session; revoke own connection                                  |
| `POST` | `/api/platform/v1/agent-connections/exchange`              | Resource-bound OAuth token; short-lived credential plus server-bound context |

These routes determine project ownership from the verified Session, persisted consent or OAuth binding. Exchange and revoke accept only an empty JSON body; all mutations require a UUID `Idempotency-Key`. Input/output schemas, 16 KiB request-body limits, no-store responses and controlled errors apply throughout. Database or provider failures expose no upstream details. Management views never return credentials.

### Public OAuth deployment on port 7100

The current deployment enables the GoTrue OAuth 2.1 server, dynamic client registration, and `platform_private.agent_access_token_hook`. Web `/oauth/consent` leads to the authenticated bilingual consent page. It first associates the authorization request with the human through Supabase, then reads eligible Projects from the WISER API. The user explicitly chooses one Project, mode, security ceiling, and duration, or denies access. WISER commits the bounded Project grant before Supabase approves the authorization code. MCP metadata publishes `https://mcp.wiser.thuenv.tiangong.world:7100/mcp` as the resource and `https://auth.wiser.thuenv.tiangong.world:7100/auth/v1` as the issuer. The Auth proxy allows only `/auth/v1` and the exact `/.well-known/oauth-authorization-server/auth/v1` path; it rewrites the latter to Kong's Auth route without exposing Kong REST or Storage.

As of 2026-09-26, public discovery, the PKCE authorization entry, dynamic registration, anonymous 401, and the browser sign-in redirect have been checked. Personal browser approval/denial, a real MCP client's token exchange, Project isolation, and revocation remain to be jointly tested, so end-to-end status is **BLOCKED**. Public self-registration is disabled: the deployed Auth API reports `disable_signup=true`, and a public signup attempt returns `signup_disabled`. Existing email/password authentication remains enabled; administrative invitations require their own delivery and recipient acceptance evidence.

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

Data and EXCON interactive reads share one server-only session verifier. It verifies authenticated, unexpired claims first, obtains the current access token, and requires its subject, session, role and expiry to match those verified claims. A failed or mismatched session never falls back to `WISER_WEB_OPERATOR_TOKEN`. That operator/service identity remains available only for explicit local Auth-off development; production EXCON reads use the signed-in user and API authorization.

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

## Project management policy boundary

The pure project-access policy distinguishes `platform.membership.manage` from `platform.access.approve`. A project-management or data-read scope alone never permits delegation. Grants require an explicit assignable-role policy, an active ordinary business role, a bounded expiry within that policy and the manager's effective authority, and a security ceiling no higher than the manager's. Roles carrying platform scopes cannot be assigned through this workflow. Self-grants and self-approval are denied; management members cannot be removed through the ordinary member-removal action. Their lifecycle remains a trusted maintenance operation, protecting the last administrator as well as other management positions.

The opt-in project-access transport and PostgreSQL service verify a live direct human Session, load current scoped facts inside the transaction, and protect concurrency, retries and audit. The policy does not read user metadata, create an identity store, grant dataset-specific download rights or change existing Data authorization.

## Project member API

After applying the Supabase project-access migration, `WISER_PROJECT_ACCESS_ENABLED=true` registers `/api/platform/v1/access/projects`, project-scoped `/projects/:projectId/members`, and the POST `/grants` and `/revocations` commands under that prefix. The switch is off by default and disabled deployments retain their previous routes. The API never accepts service-role or delegated identities as human administrators. Pagination is bounded at 50; unknown command fields are rejected; responses allowlist public fields and are private/no-store.

An explicit private role policy controls assignable roles and maximum days. New seeds configure the local owner scopes and a data-reader policy but leave project discovery disabled; existing deployments receive no automatic manager or discovery grants. Administrators cannot modify themselves or activate tenant management roles through ordinary project membership. Membership expiry limits all project role use. Revocation affects that project, retains the Auth account and tenant membership, and revokes project bindings. Reactivation does not revive other old grants.

Commands recheck authority, serialize on the project, compare membership versions, enforce actor-scoped idempotency, advance the effective authorization version, and atomically append member history, authorization audit and Control Outbox. A replay returns the original command receipt; clients must reload current membership before showing effective access. The audit and idempotency rows are immutable. Invitation delivery is described below; the independent approval workflow is described below.

The trusted host maintenance entry `apps/api/src/platform/project-access-bootstrap-cli.ts` initializes an isolated access demonstration and a separate, legacy-mode intake project from a private JSON configuration. Run it with `--dry-run` first; the complete transaction is rolled back after validating current authority, the three existing preview memberships, role definitions, expiry bounds, and database constraints. `--apply` commits the same bounded plan with append-only access events, authorization audit and Control Outbox. The three temporary accounts retain their existing source-project bindings; only the first three receive project-bound demo appointments for at most seven days. The researcher receives a dedicated read/delegation role on the source project and an intake/operation role on the separate trial project, without publish, approval or member-management scopes. No managed resource settings are created. Re-running an applied configuration verifies exact existing state without extending expiry. A changed requirement needs a new reviewed configuration or access revocation through a trusted maintenance transaction; do not delete audit history or enable source-project managed mode as recovery.

## Project access workspace

With the same feature switch enabled on Web and API, the Account menu opens `/[locale]/account/access`. A freshly verified human Session is required. My access shows the current user's effective roles and membership expiry; an active membership row without effective roles is not presented as usable access. Members & permissions is available only for projects with management authority, with scoped search, paging, role/expiry changes and project revocation. The same-origin Web transport forwards the current Session, enforces same-origin JSON writes and bounded request/response bodies, and never falls back to a static or administrative credential. Each command carries a stable idempotency key and expected membership version; the member list is cleared and reloaded after mutations or permission failures.

`WISER_ACCESS_ENVIRONMENT=local` labels an explicitly configured local demonstration; otherwise the page labels the current site. It does not select a database or synchronize accounts. Web uses its configured Supabase instance and internal API origin. Keep those together when preparing an isolated preview. The Account menu also retains own-password and sign-out actions in a keyboard-accessible disclosure, avoiding overlapping primary navigation on narrow displays.

Real-session browser checks use `apps/web/playwright.access.config.ts` against an explicitly supplied loopback origin. Supply the `WISER_ACCESS_E2E_` origin, manager/reader email and password, and project ID from an ignored environment. Use only disposable synthetic members: the checks change expiry and revoke the reader. Trace, screenshots and video are disabled during credential-bearing checks. The normal reference-browser suite skips this separate integration fixture; its absence is not a real-Auth acceptance result.

## Recoverable project invitations

Managers register invitations under `POST /api/platform/v1/access/invitations`, then explicitly dispatch `POST /api/platform/v1/access/invitation-deliveries` (both carry a project ID); `GET /api/platform/v1/access/projects/:projectId/invitations` lists records. Listing is scoped, bounded and no-store. The Web workspace offers email, configured role, expiry and reason, plus refresh/retry and separate account-acceptance status. “Grant completed” is a historical receipt; current membership and resource authorization remain authoritative after expiry or revocation.

Apply `20260922094832_project_access_invitation_delivery.sql`. Sending requires both the project-access flag and API-only `WISER_PROJECT_INVITATION_ENABLED=true`, a server-only `SUPABASE_SERVICE_ROLE_KEY`, and a fixed `WISER_PROJECT_ACCESS_WEB_ORIGIN` (HTTPS outside loopback). Configure Auth Site URL for that WISER origin and its invite template using `apps/web/public/auth-email-templates/invite.html`; the repository does not silently change existing mail configuration. Validate SMTP, proxy Origin and log redaction before inviting real people. Never expose the administrative key to Web clients.

Registration commits before any Auth request. Delivery records a versioned claim, uses an eight-second provider timeout without redirects, and then rechecks the human Session, project authority, role policy, expiry and exact Auth identity/email binding before an atomic grant plus audit/outbox. Existing confirmed accounts are reused without another invitation email. Failure never implies a grant or confirmed delivery; a provider timeout may be an unknown outcome. Explicit retry reloads the current version; an in-progress delivery cannot be reclaimed for 60 seconds. Actor-scoped idempotency prevents repeated dispatch for the same operation; no distributed exactly-once email guarantee is claimed. The account is preserved if authorization fails.

Acceptance is read back from Auth email confirmation, separately from sending and grant processing. Local mail-capture acceptance is an isolated integration result, not proof of external delivery. The native-form browser regression checks a non-null exact Origin and origin-only Referer in both locales.

## Independent access requests and decisions

Apply `20260922102329_project_access_requests.sql` after the invitation migration. With project access enabled, the workspace adds actionable requests under My access and an Approvals & history tab only for current holders of `platform.access.approve` in the selected project. That scope does not confer member-management authority. Project discovery/request settings and allowed ordinary roles remain explicit private policies; migrations never publish projects or promote existing users.

The API provides project-scoped GET `/projects/:projectId/requests` and `/events`, and POST `/requests`, `/request-decisions`, `/request-withdrawals`, `/request-executions` under `/api/platform/v1/access`. Requests derive the applicant from a freshly verified human Session. An ordinary applicant sees only their own requests; an authorized approver sees that project's queue. Events require management or approval authority. Lists are bounded, no-store and allowlisted; mutations reject extra authority/identity fields.

Submission does not grant access. An independent approver records approve/reject plus a reason, then the same still-authorized approver explicitly executes the approved request. Execution rechecks the role policy, expiry, actor, tenant and membership, and compares the membership version captured at submission. The transaction includes the effective grant, audit and outbox. The UI distinguishes decision history from current access; expired, revoked or changed memberships cannot appear as an active historical grant. Self-approval, stale decisions, unauthorized execution and role escalation fail closed.

A failed execution retains a bounded reason and a new request version. After refreshing, a transient failure can be retried with current authority; a version conflict must not overwrite an intervening change. The applicant can withdraw pending, approved or failed-but-unexecuted requests and submit a fresh request for independent review, including when the original approver is no longer available. Once effective, withdrawal is not revocation: an authorized manager must revoke the project membership. Concurrent withdrawal/execute and approve/reject are serialized with optimistic versions and actor-scoped idempotency.

Use isolated synthetic accounts for applicant, approver and manager. Verify request → decision without access → execution → actual catalog/original/graph/map reads → revocation using the same unexpired Session. Previously issued signed file links retain their own bounded lifetime; denying new resource requests does not erase downloaded copies. This prototype does not introduce per-dataset grants, separate download permission, professional knowledge approval, cross-environment account synchronization or controlled computation.

## Immutable resource grant evaluation

`ResourceAccessGrantSnapshot` in Platform contracts pins the subject, Tenant, Project, Purpose, resource-package and preset versions, exact DataItem/Version or external-source references, actions, activation and expiry. `evaluateResourceAccess` is a deterministic additional restriction, with time and current authority facts supplied explicitly. A content-read grant never implies original-download, export or external-directory permission. Revoking one grant preserves independent overlapping grants; results list the matching grants and the earliest revalidation deadline. Malformed or duplicate authority facts fail closed.

The production composition now loads the immutable resource authority after verified human/delegated resolution. Apply the control-plane resource migration and Data migration 0030 before starting this runtime; a missing or unavailable authority fails closed. Migrations do not enable any project. Managed-project administration and full browser acceptance remain separate delivery gates. Explicit legacy mode preserves existing gates; managed mode requires a matching live grant. Existing session, project, scope, security-level, resource and provider checks remain mandatory in both modes. Do not accept evaluator authority inputs from browser requests or treat its expiry as permission to cache through a revocation.

The pure resource scope compiler groups immutable references by action, bounds each result, and intersects delegated resource grants with the delegator. Its next revalidation boundary includes future activation and expiry; malformed authority snapshots fail closed. Project settings determine activation; absent settings preserve legacy behavior.

The runtime resource-scoped resolver attaches a fresh control-plane scope to a verified session. It binds the snapshot to the exact subject, project and purpose, requires the verified delegator, and fingerprints the effective scope for cache separation. It does not cache grant reads or fall back on authority failure. It is shared by the platform identity route and sibling system transports.

The PostgreSQL resource authority loader reads project settings, exact package/preset versions, revocations and database time in one statement. It selects only the verified subject and any verified delegator, within the exact project and purpose, and rejects an oversized live grant set rather than truncating rights. The isolated integration suite checks legacy compatibility, immutable package references, purpose/subject separation and immediate revocation. Data receives this trusted context, never caller-supplied resource grants. Managed projects currently admit only the explicit resource-aware capability set; unscoped ingestion, operation, reconciliation and maintenance commands are denied before execution until ownership enforcement is completed. External directory reads additionally require an exact external.directory source grant and independent live provider permission.

## Resource definition administration

`PostgresResourceAdministrationService` stores immutable resource-package and permission-preset versions in the existing control plane. It requires a live direct human Session and current `platform.membership.manage`, locks the project and resource revision, and reuses the actor-scoped command journal for retries. Version conflicts never replace earlier definitions; creating a definition grants no access. Resource settings must already exist; these methods do not activate legacy projects.

Package creation requires a trusted application validator for exact resource visibility and license limits, with a five-second deadline and cancellation. It receives the current verified context and the independent single-use management permit, never browser-supplied authority. Data authority is accessed through that application port, never a control/Data database join. The caller records the license basis and reason. Original-read, result-export and external-directory presets require important approval; a later request cannot relabel these actions as ordinary. Receipt and audit identify the immutable version and new authority revision. Definition HTTP/UI wiring is available; separate batch methods own approval and execution.

The resource-administration HTTP module provides bounded latest-version listings and strict package/preset creation commands, with private no-store responses and required idempotency keys. Listings expose package counts and declared license bases, not the full resource member list. Only a live human with project membership-management authority can use the service; management does not imply content access. Runtime composition requires the trusted Data validation port.

Resource administration uses a metadata-only validation port. After checking the current source policy under control-plane project/settings locks, Platform issues a process-local, single-use permit bound to the verified actor/session, tenant, project, purpose, roles, scopes, security ceiling, authority version, exact resources and requested actions. It expires within five seconds and never outlives source permission. A serialized copy, changed request or replay is rejected before Data access. The port performs one bounded boolean check of fixed versions, publication, acceptance and source authorization text in a private read-only transaction. It installs only those exact references in the existing transaction-local version RLS transport; it never changes personal grants or passes that connection/scope to content, evidence, original or export adapters. Tenant/project/security RLS remains effective. Cancellation and expired results fail closed. Personal content access is neither required nor granted. External sources still require their separate registry port; management coverage browsing remains a separate integration gate.

Resource batches preserve an explicit list of at most 50 current human project members and immutable package/preset versions. Preview expires after at most 15 minutes and creates no grants. Approval requires a different actor with current `platform.access.approve`, excludes applicants and recipients, and requires a configured role for important actions. Execution rechecks the recorded approving session, current authority, definition versions, Data validation, and separate project-membership, tenant-membership and actor authority versions. It records each recipient attempt, uses a savepoint for a temporary grant failure, and skips successful recipients on retry. Idempotency is actor scoped; reusing a key with different input fails. The authenticated HTTP module exposes bounded batch lists and preview, decision, execution and withdrawal actions. Managers and approval-only reviewers may read the project list; ordinary members cannot inspect other recipients. Only the applicant may withdraw a pending request. Every command requires a caller-scoped idempotency key and preserves audit history. UI acceptance remains separate.

Each batch explicitly selects `web-console` (Web access) or `agent-data` (AI/MCP access). The form, approval view and grant record show that purpose. Counts, differences and preview fingerprints include only grants for the selected purpose; unrelated-purpose revocation does not invalidate a preview. Renewal preserves the original purpose and still requires independent approval. Existing grants retain their purpose; this migration grants nobody access. Older pending previews without the purpose-bound fingerprint must be regenerated. An owner's AI/MCP grant is an upper bound for a separately consented delegation, not proof that a managed client already has a matching resource grant; OAuth and resource acceptance must both be verified.

Batch previews now store per-member differences over the entire proposed interval. Counts are resource-version/action pairs: new, extended interval, already covered, and zero removals for additive grants. Adjacent overlapping grants are unioned without covering temporal gaps. A fingerprint of relevant immutable grants must still match at approval and before each execution; changed authority requires a new preview. Historical previews without a difference snapshot remain unknown and cannot be approved or executed. These record differences do not establish source/provider permission.

Resource grant administration lists bounded records for the current member; inspecting another member requires project membership-management authority. Record status describes its stored term/revocation, not a guarantee of effective Data access. Managers may revoke a selected grant idempotently; the immutable original and unrelated grants remain, with a separate revocation and audit. Renewal creates a new pending batch beginning at the later of now or the old expiry, reusing exact definitions and all independent-approval, duration, membership and Data checks. It never edits the old expiry. The preview audit links the original grant. Local revocation affects that grant only; later independently approved renewal grants remain separate.

The Resource grants tab lists the signed-in member’s records; managers can select a member from bounded project pages. Status describes the recorded period/revocation, separately from actual access. A reasoned single-grant revocation preserves independent grants. Renewal produces a new pending batch using fixed package/preset versions; independent approval and execution are still required. HTTP and same-origin Web routes validate IDs, reject extra fields, preserve actor-scoped idempotency and disable caching. Switching project/member clears in-flight editors; uncertain retries retain their request key.

Managed projects now load trusted source-policy ceilings in the same control-database statement as grants, revocations, the revision and time. Immutable `resource_policy_versions` bind one exact resource to a monotonic identity/version chain, permitted actions, management roles, license evidence and validity; an independent approval identity is required. Append-only `resource_policy_revocations` invalidate the current version without deleting history. Both tables are private, force RLS, deny generic client/service-role access, and advance the project authority revision.

The loader always supplies policy limits in managed mode: missing, expired, future or revoked current policy denies the affected resource. It selects the latest published version without falling back to older permissions and fails closed above 10,000 current resource policies. Member and delegator grants are intersected with those limits. Legacy projects retain existing behavior; the migration seeds no policy or project activation. Apply the control migration before updating API services. Management coverage browsing and the related UI remain separate integration gates: package-entered license text is never a trusted source policy.

Resource-package creation checks current source permission before Data validation: the operator must hold a permitted management role, every requested action must be allowed, and the source permission must be active. Batch preview, approval and execution check the proposed period against source validity and maximum grant duration. Execution also rechecks the recorded approver's current source-management role. Revocation or narrower management eligibility stops new approval/execution without deleting historical records. Project/settings locks serialize these checks with source-policy changes. Source-management eligibility and fixed-version metadata validation neither require nor create personal content grants. Rejection, withdrawal and revocation remain possible without extending source permission.

Resource preview fingerprints also bind the selected source-policy identities and immutable versions. Republishing any selected source policy invalidates earlier approval/execution even if its action ceiling still permits the request; unrelated source policies and result ordering do not invalidate it. The existing preview hash stores this binding with the recipient grant snapshot, so no migration or public payload change is needed. Old pending previews must be regenerated after upgrading this logic. Successful recipients remain recorded; a partially executed batch cannot use changed source authority to grant its remaining recipients.

Source stewardship uses explicit per-project `resource_policy_roles` appointments in addition to live membership-management or approval scopes. Existing administrators are not automatically appointed; seed grants nobody. The source proposal queue is bounded to 20 records and exposes only the declared request view. Commands record actor-scoped idempotency and append audit events. The applicant cannot approve their own proposal. Publication rechecks the original applicant's live direct session and current appointment, both applicant/reviewer metadata visibility, exact source identity/version and accepted, published Data facts. It records the immutable policy and decision in one control transaction; read-only Data validation is not a distributed write. No personal content grant is created. Rejection/withdrawal leave no source permission; revocation appends history and invalidates current authority. Provider sources remain fail-closed until the provider registry port is connected.

The existing authenticated resource-administration module now serves GET `/api/platform/v1/access/projects/:projectId/source-policy-requests` and POST `/api/platform/v1/access/source-policies/{propose,decide,withdraw,revoke}`. Commands reject caller-supplied authority, require an idempotency key and retain no-store responses; roles are configured only by trusted maintenance. These endpoints are not public registration and do not perform scientific review. The browser workflow is separately accepted.

Request lists return a server check time and a publication state derived from immutable policy versions, revocations and the permission term. Newer publication supersedes an older record even when that newer policy is revoked; the old policy never becomes effective again. Historical decision receipts stay unchanged. Publication/rejection belongs to the independently appointed approval role; withdrawal and revocation require the source proposal/management role, and withdrawal also requires the original applicant. Web controls follow those same distinctions.

The consent document uses `same-origin` referrer policy: native approval and denial forms retain the same-origin `Origin` header required by the decision route, while external callbacks receive no consent-page referrer. A document-wide `no-referrer` policy makes Chromium send `Origin: null` on these forms and blocks valid consent. Keep rejecting missing, null and foreign origins; the decision redirect response still uses `no-referrer`. The reference Playwright server explicitly sets its own public origin and exercises both locales, both decisions and external referrer privacy.
