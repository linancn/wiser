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
lastReviewedAt: 2026-09-07
lastReviewedCommit: 626cfd1c22e8c24fb38306520c4e9433a5984151
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
