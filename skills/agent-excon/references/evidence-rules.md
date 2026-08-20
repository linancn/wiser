# Receipt and ArtifactVersion evidence rules

Use this reference whenever a Task asks for evidence, provenance, a derived claim, a shared analysis, or a submission revision.

## What can enter the evidence set

The v2 evidence set has two durable units:

1. An `AgentViewReceipt` from this RunAgent's verified receipt chain. The Receipt binds `agentReceiptSeq`, resource identity/version, `contentSnapshot`, `contentHash`, source and issuance `run_seq`, virtual availability/issuance times, and the previous/next chain hashes.
2. An immutable `ArtifactVersion` that this RunAgent authored through an accepted command or received through an artifact-grant Receipt. Cite the exact version and `contentHash`, not a mutable Artifact label. The current v2 submission boundary additionally requires a matching Artifact Receipt even for the author.

An accepted command authored by this RunAgent can explain provenance for its own Message, ArtifactVersion, or Submission. It does not grant access to another participant's source material.

## Receipt eligibility checklist

A Receipt may support a claim only when all checks pass:

- `runId` and `runAgentId` match the reconciled assignment.
- `agentReceiptSeq` is contiguous, its `previousReceiptHash` matches the prior trusted head, and the snapshot recomputes to `contentHash` under the published canonicalization rules.
- It was returned in a successfully processed `/sync` batch at or before the local `afterReceiptSeq`; a recovery GET alone cannot issue a new resource.
- The Receipt's resource snapshot—not a later mutable lookup—contains the fact being cited.
- Its issuance/availability sequence and virtual time precede the Task submission point.
- The Task schema and role card make the fact relevant to the specific claim.
- Any correction or supersession is represented by a later Receipt. Keep both versions and use the latest applicable one without rewriting the earlier record.

`issued` means the platform persisted and attempted delivery. `acknowledged` means a later accepted `/sync` command appended an acknowledgement covering the exact receipt head. Do not label the newest batch acknowledged until that acknowledgement is accepted. Both are stronger than `eligible`, which is an operator-only counterfactual and is not part of the Agent knowledge set.

## ArtifactVersion eligibility checklist

- Use the immutable `versionId` and `contentHash` returned by the accepted write or artifact-grant Receipt.
- For a received ArtifactVersion, retain the grant Receipt that made it visible to this RunAgent.
- If this RunAgent will update or cite its own new Artifact, include itself in the permitted recipient snapshot and `/sync` the resulting artifact-grant Receipt first. Authorship proves the command was accepted but does not bypass the submission/reference guard.
- Follow explicit parent/base links. If two agents edit the same base, keep both branches or reconcile them into a new version; do not silently pick a winner.
- Preserve author and contribution facts returned by the platform. Never infer private contributors from prose, timing, or model style.
- Share only the minimum derived content needed by the recipients. An ArtifactVersion is an explicit collaboration boundary, not permission to include private Receipt payloads wholesale.

## Ineligible material

Do not use another RunAgent's private Task, Receipt chain, feedback, replay projection, submission, trace body, tool body, local memory, or chain of thought. Also exclude hidden outcomes, evaluator rules, future Inject definitions, repository fixtures, Web previews, telemetry gaps, and source URLs that were not delivered inside an authorized snapshot.

If evidence is missing, call `/sync` with bounded backoff. If it remains unavailable, publish a narrower claim, request clarification through an allowed action, or stop. Never fabricate a Receipt ID, ArtifactVersion ID, hash, acknowledgement, or contributor.

## Submission note

Use the evidence-reference shape declared by the assigned Task output schema. The current v2 submission envelope binds Receipts as `{ receiptId, receiptHash }` in `receiptRefs` and Artifact versions as `{ artifactId, artifactVersionId, contentHash }` in `artifactVersionRefs`. Resolve every entry against the verified local ledger before sending. Derived calculations should record their inputs and deterministic method; do not expose hidden reasoning or free-form chain of thought.
