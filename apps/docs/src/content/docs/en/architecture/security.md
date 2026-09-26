---
title: Security and data boundaries
description: Prevent fact leakage, unauthorized observations, credential spread, and unaudited changes.
docType: security-guide
scope: wiser-security
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing identity, RLS, hidden data, or audit boundaries
whenToUpdate:
  - when authorization, database security, or credential policy changes
checkPaths:
  - supabase/**
  - apps/api/**
  - apps/web/**
  - apps/mcp/**
  - apps/data-worker/**
  - apps/telemetry-ingress/**
  - packages/platform-auth/**
  - packages/data-infra/**
  - infrastructure/**
lastReviewedAt: 2026-09-26
lastReviewedCommit: ce7c39fbcc4aebc5bca1f67ee80634b7ce544c4d
---

## Separate four data classes

This page covers WISER-wide identity, database, secret, and telemetry boundaries. The table first describes Agent EXCON visibility classes; Data Foundation follows the same server-side isolation, RLS, and least-privilege rules below.

| Class                  | Examples                                                       | Readers                                     |
| ---------------------- | -------------------------------------------------------------- | ------------------------------------------- |
| Agent view             | Issued receipts, own Tasks, targeted Feedback                  | RunAgents in the fixed recipient snapshot   |
| Team shared            | Published Messages, ArtifactVersions, team Feedback            | role/team recipient snapshot at publication |
| Restricted state       | Future Injects, another agent's private traces, internal gates | EXCON services and authorized admins        |
| Facts and adjudication | Outcomes, hidden labels, full rules                            | Workers and authorized reviewers            |

Never send full fact objects to a browser or participant and rely on the UI to hide fields. Isolation starts in the server-side query.

## Supabase and RLS

Public self-registration is disabled with `[auth] enable_signup=false` and the deployed `GOTRUE_DISABLE_SIGNUP=true`. Email authentication stays enabled for existing accounts. Account provisioning and invitations require an authorized maintenance workflow; creating an account never grants Project membership by itself.

Supabase Auth is the only WISER authority for users, sessions, Tenants, Projects, Memberships, and delegated identities; Data Foundation never creates a second Auth system. `platform` and `platform_private` are not exposed to the Data API. anon/authenticated Schema, Table, Sequence, and Function privileges are revoked by default, and every table enables `FORCE ROW LEVEL SECURITY` as defense in depth.

Enable RLS on every exposed table. Data API exposure and RLS are separate: new tables need deliberate grants as well as policies. Combine `TO authenticated` with ownership, RunAgent, and recipient-snapshot predicates; configure both `USING` and `WITH CHECK` for updates and add any `SELECT` policy the update requires. Store authorization attributes in `app_metadata`, never user-editable metadata.

Frontend code receives only a publishable key. Views use security-invoker behavior, and privileged functions live in an unexposed schema with default public execution revoked. Run database advisors and tests as anonymous, authenticated, and service roles after migrations.

OAuth resource tokens carrying `client_id` do not inherit direct human access. The ordinary API JWT verifier rejects them, and exposed application tables apply the restrictive `wiser_direct_session_only` policy alongside their ownership policies. Add the same restriction when introducing another exposed table. Agent connections and OAuth credential bindings remain private and force RLS; the token hook grants only Supabase Auth the necessary read and execute privileges.

An OAuth exchange credential must retain its immutable `agent_exchange` kind and Session binding. A deferred database constraint rejects unbound issuance. The API validates that binding on every use, including OAuth consent/client revocation and Session deletion, so its short expiry is not the only revocation mechanism. A query grant excludes ingestion and publication; an ingestion grant still excludes publication.

## Time and evidence authorization

`Observation` is a v1 compatibility term. v2 has no separate Observation entity: after time and permission checks, `/sync` freezes the issued Inject payload as an `AgentViewReceipt`. A Submission may cite only a receipt belonging to that RunAgent or an ArtifactVersion explicitly granted to it.

Historical role/team visibility cannot be recomputed from present membership. Sending content freezes its recipients; a later member needs an explicit disclosure receipt to read history.

## OTel and hidden content

OpenTelemetry is a sampled diagnostic projection, not an authorization boundary. Prompts, completions, tool arguments/results, hidden outcomes, submission/feedback bodies, personal data, credentials, and hidden reasoning stay out of telemetry by default. Spans and logs contain only safe IDs, classification, model, token use, latency, status, and authorized content references.

WISER Web consumes safe DTOs from an observability gateway, not raw Tempo, Loki, or OTLP. Participants cannot connect directly to the Collector; authenticated ingress binds the RunAgent, overwrites client identity attributes, and marks data `participant_reported`. Such spans cannot affect authorization, barriers, scores, or audit facts. Missing telemetry must be labelled “not observed” rather than treated as proof that an agent did nothing.

## Credentials

Host-side Codex sign-in never enters shared containers. Do not bake `~/.codex`, access tokens, or API keys into images or Event payloads. CI defaults to the fake provider; opt-in online tests use a least-privilege secret.

Logs may retain provider, model, latency, token count, and safe correlation IDs, but never raw credentials. Uploaded content and model output remain untrusted data rather than executable system instructions.

Invitation hashes, OAuth codes and tokens in authentication URLs must also stay out of access logs. Web disables Next.js development request logging with `logging: false`. For the self-hosted Kong gateway, persist `KONG_PROXY_ACCESS_LOG=off` and `KONG_ADMIN_ACCESS_LOG=off`, or use a reviewed format that excludes query values. Keep router logs and error reporting free of authentication URLs. Before sending a valid invitation, probe every hop with a harmless marker and check both stdout and stderr; never use a real credential as the logging probe.

## Compose security

Pin Supabase images as one compatible set and validate the gateway configuration with that set. Real `.env` files never enter Git. Database and Studio endpoints bind only to localhost or a controlled network by default; public deployment adds TLS, backups, key rotation, and network policy.

Normal `docker compose down` preserves data. Volume deletion requires a separate, explicit operator action.

## Security verification checklist

- [ ] Future Injects cannot be inferred from APIs, logs, or errors.
- [ ] Agent A replay, traces, and logs never include Agent B private receipts, submissions, or feedback.
- [ ] A new role assignment does not expose history without an explicit disclosure receipt.
- [ ] Idempotent retries do not duplicate work.
- [ ] Facts, rules, and human overrides retain actor, version, and domain event ID; trace ID is optional correlation.
- [ ] OTLP contains no prompt, tool body, hidden outcome, private feedback, or credential.
- [ ] Participants cannot impersonate another RunAgent or service; reported spans never enter adjudication.
- [ ] Downloads are short-lived and authorization-bound.
- [ ] RLS, SQL transactions, and negative state-machine tests pass on real PostgreSQL.
- [ ] Live AI calls are not required to merge a change.

## Project access control records

`04_project_access.sql` and its CLI-generated migration add private, forced-RLS project settings, assignable roles, invitations, idempotency receipts and immutable member events. No direct client or service-role table grants are added. Settings default to closed discovery. These are control-plane records, not a second identity store or Data Foundation migration. The optional `WISER_ACCESS_TEST_DATABASE_URL` integration suite must target a disposable migrated and seeded Supabase database; run pgTAP before integration fixtures. Never run a reset against the existing developer or shared instance.

Access requests also remain in the private forced-RLS control plane. Approval is independent of the applicant and is not itself a grant. Current reviewer authority, configured role bounds and membership versions are rechecked at execution; original audit receipts remain immutable after withdrawal, expiry or revocation.

## Immutable resource authority

`05_resource_access.sql` adds private forced-RLS settings, immutable package/preset versions, grants, separate revocations and audit events. Existing projects remain legacy unless explicitly configured; seed data does not enable managed mode or issue new grants. Settings cannot be deleted to restore broad legacy access. Changes advance a project resource revision, while package/action and duration constraints bind every grant to exact versions. Browser and generic service roles receive no direct table access. Run the new pgTAP suite and complete reset/lint/advisor gates only in a disposable instance. API management, provider ceilings and Data outlet enforcement remain required before enabling this mode for real users.

## Bounded resource batch storage

`06_resource_batches.sql` stores immutable fixed-version batch snapshots, at most fifty explicitly numbered recipients, append-only per-recipient attempts and important-approval role policy in the private control plane. Pending requests produce no grants. State changes require increasing versions; applicants and recipients cannot approve their own batch. Approval freezes recipients, purpose and expiry. Successful receipts must reference a grant matching the approved resource/preset versions and recipient; success cannot be repeated. No approver or request is seeded. Runtime review, current membership, provider and Data validity checks remain mandatory; these storage constraints alone do not enable a batch workflow.

Source-policy workflow storage (`20260923065331_resource_policy_administration.sql`) adds explicit project stewardship role configuration and immutable proposals. It grants no stewardship roles or source permissions by default. Proposals begin pending, require optimistic state transitions, retain their submitted evidence, and cannot be deleted or reopened after a terminal decision. Publication must refer to an exactly matching immutable policy, including independent approver and applicant identities. Withdrawal creates no permission. Both tables force RLS and deny direct anonymous, authenticated and generic service-role access. Configuring stewardship remains a trusted maintenance operation; runtime authorization, HTTP and UI acceptance are separate from these storage checks.
