---
name: wiser-workbuddy-showcase
description: Operate the local WorkBuddy GUI as the host controller and present a four-agent WISER Yongding exercise in the collaboration console. Use for a scripted, Red-to-Green rework, or explicitly authorized live WorkBuddy showcase; do not use this skill to participate as a fifth RunAgent.
---

# WISER WorkBuddy showcase

Direct the demonstration from outside the exercise. WorkBuddy Lead manages the
showcase process; four isolated participant processes do the case work through
role-scoped WISER MCP servers. Codex and Lead are never RunAgents.

## Choose the profile

- Use `scripted` first for a deterministic protocol demonstration whose four
  participant processes do not call models.
- Use `rework` after scripted to show `REWORK_REQUIRED` followed by immutable
  revision 2 and `ACCEPTED`.
- Use `workbuddy` only after the user explicitly authorizes live model use in
  the current task. Historical local runs include a four-role `429` quota
  failure; treat another `429` as terminal and never retry automatically.

Operating the GUI through a WorkBuddy Lead can itself consume the signed-in
WorkBuddy subscription even when the four participants are scripted. Treat an
explicit request to operate WorkBuddy as Lead-use authorization; if the user
forbids all model use or only asks for a zero-cost dry run, do not open
WorkBuddy. Run the deterministic supervisor directly or provide manual steps,
and state that no GUI operation occurred.

## Operate the showcase

1. Read [safety-boundaries.md](references/safety-boundaries.md) before any
   command or GUI action.
2. Read [gui-runbook.md](references/gui-runbook.md) when operating WorkBuddy
   and the WISER browser view.
3. Run `pnpm showcase:preflight`. Stop if it does not pass.
4. Use Computer Use to open WorkBuddy, create one Lead task in this repository,
   and send the profile-specific instructions from
   `examples/agent-excon/workbuddy-yongding-tdd/showcase/WORKBUDDY_LEAD_SHOWCASE_TASK.md`.
5. Use `pnpm showcase:status` only to reconcile the redacted session state.
   Read neither credential files nor role MCP configurations.
6. Use the browser to open the session's WISER `/collaboration` URL. Present
   messages, ArtifactVersions, delivery Receipts, replies, evaluation,
   endorsement, and Barriers as separate facts.
7. Ask the WorkBuddy Lead to run `pnpm showcase:stop` after the demonstration,
   then verify cleanup through the redacted status. The fifteen-minute TTL is a
   fallback, not a reason to leave the session unattended.

Use four independent top-level processes. Never add `--swarm`, `-y`,
`bypassPermissions`, a shared-token environment, or a WorkBuddy business
mailbox. If Computer Use or browser control is unavailable, stop and provide
the manual handoff instead of claiming the GUI was operated.

Report the profile, Run ID, latest deterministic verdicts, released Barriers,
interaction/delivery summary, telemetry coverage, absolute report path, and
cleanup state. An OS exit code, Agent prose, or OpenTelemetry signal is not an
authoritative pass.

## English

This skill directs a bounded WorkBuddy GUI showcase while four isolated WISER
RunAgents collaborate through the platform. Scripted and rework profiles are
the safe defaults; live model use requires current, explicit authorization.
