---
name: agent-excon
description: Participate as one external RunAgent in a multi-agent WISER Agent EXCON exercise through the v2 HTTP or MCP protocol: reconcile the assigned identity, sync receipt-gated work, hold task leases, collaborate through messages and immutable artifacts, submit or endorse results, act on scoped feedback, wait at barriers, and hand off a safe replay cursor. Use this Skill whenever an agent is asked to join, run, resume, debug, or recover its own exercise work. The Web console is for management, visualization, and replay—not participation. Use the isolated v1 fallback only when the task explicitly identifies a legacy protocol.
---

# Agent EXCON

Act as exactly one assigned `RunAgent`. The exercise service is the environment; HTTP or MCP is the participant boundary. Other agents may work concurrently, so keep the Run lifecycle separate from the Task lease and never assume the whole team shares your context.

## Select the protocol

Use `protocolVersion: v2` by default. Resolve the API origin, `runId`, RunAgent credential, and expected `runAgentId` from explicit bootstrap input or a trusted environment. Do not infer an identity from a display name, role label, browser page, repository fixture, or another agent's output.

Read [interaction-protocol.md](references/interaction-protocol.md) before the first call. If the assignment names an MCP server, use the equivalent v2 tools and read machine fields from structured results; MCP remains an HTTP adapter.

Only load [v1-compatibility.md](references/v1-compatibility.md) when the operator or server explicitly declares the legacy protocol. A missing v2 capability, transient failure, or authorization error is not permission to downgrade.

## Keep a durable local cursor

Preserve this state across calls and handoffs without storing credentials:

```text
protocolVersion, runId, runAgentId, roleSlotId
afterReceiptSeq, receiptHeadHash, runCursor
taskId, taskLockVersion, claimEpoch, leaseToken, leaseExpiresAt
artifactId, artifactVersionId, submissionId
pending command: method, path/tool, canonical body, idempotency key
```

Treat the lease token and bearer credential as secrets. If a process restart loses an unresolved write record, stop and reconcile instead of guessing whether the command succeeded.

## Run the v2 loop

1. **Reconcile assignment and identity.** Call the assignment operation and require its `runAgent.id`/`runAgent.runId` to match the trusted bootstrap. Record the role assignment, role card, sync cursor, and the Task/output schemas later issued by the pinned scenario version; role-specific duties come from those resources and the scenario/role Skill Pack, not from this generic Skill.
2. **Sync the only new-content channel.** Send `/sync` with `afterReceiptSeq`. On every call after a non-empty batch, acknowledge the prior contiguous receipt head with the exact sequence and hash. Validate the returned RunAgent, bounds, per-Agent sequence, previous-hash chain, content hashes, and `runCursor` before accepting snapshots. Advance the durable cursor only after processing the whole batch.
3. **Recover issued resources.** List already-issued Tasks, Messages, Artifacts, Submissions, and Feedback to rebuild local state. These reads never reveal newly eligible content and never replace `/sync`.
4. **Claim and begin one ready Task.** Use the Task's own `lockVersion`, not the Run version. Preserve the returned `claimEpoch` and lease token, begin with that exact lease, and heartbeat before expiry during long work. A stale or expired holder must stop writing; it cannot rescue the lease by inventing a new token.
5. **Build evidence from receipts and artifact versions.** Read [evidence-rules.md](references/evidence-rules.md). Use only your own verified Receipt snapshots, accepted commands you authored, and explicitly authorized immutable `ArtifactVersion`s. Never read another agent's private view, submission, feedback, trace payload, hidden outcome, or chain of thought.
6. **Collaborate explicitly.** Send a Message for a bounded communication and publish an Artifact for reusable evidence or analysis. Choose only permitted recipient scopes; the platform freezes the recipient snapshot. Update an Artifact from its declared base version and preserve both branches on conflict. Do not imply that shared team membership grants shared memory.
7. **Submit or endorse.** Validate the assigned output schema locally, heartbeat if needed, then create an immutable Task submission using the active lease and current Task version. Reference Receipt and `ArtifactVersion` evidence rather than copying private source material. Before endorsement, `/sync` both the Submission and Feedback Receipts, recover the exact immutable snapshot with `GET /runs/{runId}/submissions` or `excon_list_submissions`, and review that snapshot before consuming its matching ActionGrant. A Feedback ID is never a substitute for content review.
8. **Process scoped feedback.** Read [feedback-and-errors.md](references/feedback-and-errors.md). Keep `individual`, `role`, and `team` feedback separate. An allowed-action label is advisory; a mutation that revises, resubmits, endorses, or requests clarification must carry the matching unexpired `feedbackActionGrantId`. A revision creates a successor and never overwrites its predecessor.
9. **Wait at the Barrier.** Once your Task is accepted or submitted as required, use bounded `/sync` polling and lease-safe recovery. Do not advance the global virtual clock, release a Barrier, or impersonate a coordinating or operator capability. A readiness Message is not a clock command.
10. **Hand off a safe replay cursor.** Request only your own `agent` perspective with `deliverySemantics=issued` or `acknowledged`, at or before the last trusted `runCursor`. Report Event/Receipt facts and telemetry gaps separately; telemetry is best effort and is never proof of what another agent knew.

## Command discipline

- Give every intended write a fresh UUID `Idempotency-Key`. After an ambiguous response, retry only the identical method, target, actor, body, and key; otherwise reconcile first.
- Apply optimistic versions to the smallest aggregate: Task lock version for Task transitions, base version for Artifact updates, and the relevant grant/submission identity for feedback actions. Do not serialize team work on the Run version.
- Treat submissions, Artifact versions, Messages, Receipts, acknowledgements, and domain Events as append-only facts.
- Deterministic evaluators own scores, Barrier decisions, and verdicts. AI may explain participant-visible results but must not change them.
- Keep business `run_seq`/virtual time distinct from wall-clock lease expiry and OTel duration.
- Surface stable error codes and the next safe action. Do not infer hidden information from timing, missing fields, scores, or telemetry gaps.

## Progressive scenario references

Load scenario references only after reconciling the assignment:

- For the versioned Yongding River collaboration case, read [yongding-allocation.md](references/yongding-allocation.md), then load only the section matching the assigned role card and Task output schema. Run its allocation validator only for a Task that actually produces that plan shape.
- For any other scenario, use the published Scenario/Role Skill Pack pinned by the assignment. Do not transplant Yongding topology, roles, rules, or payloads into it.
