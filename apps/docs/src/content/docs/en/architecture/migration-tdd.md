---
title: v1 migration and v2 TDD
description: The online cutover from single-agent Episodes to multi-agent Runs and the first failing tests.
docType: migration-guide
scope: agent-excon-v2
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when changing v1 compatibility, v2 migration, or deterministic evaluation
whenToUpdate:
  - when migration order, TDD gates, or persistence status changes
checkPaths:
  - apps/worker/**
  - packages/infra/**
  - supabase/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

## Migration invariant

The v1 walking skeleton remains a compatibility protocol while facts converge on v2. Episode and Run tables must not remain dual-write authorities because state, events, receipts, and outbox records could no longer commit atomically.

## Online cutover order

1. Deploy v2 tables, RLS, Tasks/Barriers, Event/Receipt/Outbox, and `legacy_episode_map` without changing v1 routes.
2. Map ParticipantVersions to immutable AgentVersions and publish a one-role legacy compatibility blueprint. Newly published v2 scenarios still require distinct RunAgents in multiple roles.
3. Before facade cutover, migrate and reconcile every unfinished Episode. A missed object is imported atomically in one serializable transaction on its first v1 write.
4. Once an Episode has a map, old fact tables reject writes for it. v1 observe/submit/advance/events translate only to v2.
5. A Supabase session or legacy hashed API token performs a one-time exchange for a short-lived RunAgent credential. The new secret is shown once and the old token is revoked.
6. M5 migrates cold completed history. A legacy Observation becomes `issued` with `provenance=legacy_import` and `deliveryConfidence=unknown`; migration never fabricates an acknowledgement.
7. After v1 traffic reaches zero, disable v1 writes and leave old tables read-only.

## Minimum v2 walking slice

M2 delivers minimal create/join/start behavior for a fixed published scenario. M3 uses it to run the four-role Yongding fixture; the visual scenario editor and full manual control surface remain in the later management milestone.

The acceptance outcome is four distinct RunAgents receiving different receipts, executing Tasks concurrently, converging through Artifacts/Messages into a team Submission, and receiving individual, role, and team Feedback.

## First Red tests

### Concurrency and state

- Different Tasks submit concurrently without conflict; evaluation of one Task never freezes another.
- Only one concurrent claim succeeds. After lease expiry another agent can claim, and the stale token cannot heartbeat or submit.
- A Barrier releases once when several Tasks complete concurrently.
- The event head assigns contiguous unique `run_seq` values; a failed transaction leaves neither state nor event gaps.
- The same idempotency key and hash returns the original response; a different hash returns 409.
- A stale Artifact `baseVersionId` creates an explicit branch or stable conflict and never overwrites concurrent work.

### Identity, versions, and authorization

- One RunAgent holding several roles cannot satisfy the required-role quorum.
- Published ScenarioVersion/AgentVersion content is immutable; retirement appends a lifecycle event.
- Expired, revoked, or rotated credentials fail immediately; identity revocation removes active RunAgents.
- Public scenario APIs cannot read or infer drafts, validation failures, or readiness.
- Role Feedback is limited to its issuance recipient snapshot; a `feedback_action_grant` cannot cross agent/task, expiry, or use limits.

### `/sync` and replay

- Retrying one `/sync` command returns the original delivery batch without duplicate receipts.
- GET tasks/messages/artifacts/feedback reconciles issued content and never turns eligible content into issued content.
- An incorrect acknowledgement head/sequence fails, and receipts are never mutated.
- Operator, team, role, and agent projections differ correctly at the same `run_seq`.
- Agent A replay contains none of Agent B's private receipt payloads, submissions, feedback, or tool content.

### Telemetry

- Without an exporter, only EXCON boundary spans appear; the UI never invents internal agent activity.
- A participant exporter cannot impersonate another agent or service, and its spans remain `participant_reported`.
- Reported spans cannot change authorization, barriers, scores, or audit facts.
- Deleting all telemetry leaves Event/Receipt replay complete.

The full design and additional fault-injection cases live in `docs/design/v2-multi-scenario-multi-agent-observability.md` in the repository.
