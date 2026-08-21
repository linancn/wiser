---
name: wiser-yongding-four-agent-tdd
description: Run, validate, or diagnose the local WISER Yongding River four-agent WorkBuddy TDD Cookbook. Use when asked to start four local WorkBuddy agents, prove the scripted or rework profile, perform an explicitly authorized live WorkBuddy run, inspect the redacted authoritative report, or explain why this lab must not use swarm, shared tokens, or side-channel collaboration.
docType: agent-skill
scope: workbuddy-yongding-tdd
status: active
authoritative: true
owner: wiser
language: en
whenToUse:
  - when running or diagnosing the four-agent Yongding TDD Cookbook
whenToUpdate:
  - when required commands, profiles, evidence, or safety rules change
checkPaths:
  - skills/wiser-yongding-four-agent-tdd/**
  - cookbooks/workbuddy-yongding-tdd/**
lastReviewedAt: 2026-08-21
lastReviewedCommit: cca05b0bfc076853dfba2dd8bfc7431eb767d1ee
---

# WISER WorkBuddy four-agent TDD

Act as the host controller, never as a fifth WISER participant. From the repository root, read `cookbooks/workbuddy-yongding-tdd/README.md` and its architecture/failure references before running a command.

## Required sequence

1. From the repository root, run `pnpm cookbook:scripted` and require a passing `cookbook-report.json`.
2. Run `pnpm cookbook:rework`; require a water-evidence `REWORK_REQUIRED` followed by immutable revision 2 `ACCEPTED`, with `tddCycle.greenAccepted=true`.
3. Only after explicit user authorization for model use, run `WORKBUDDY_LIVE=1 pnpm cookbook:workbuddy`. Never infer authorization from a request to inspect, plan, or run scripted CI.
4. Read only the redacted report and role process summaries. Report profile, Run ID, latest role verdicts, released barriers, telemetry coverage, and absolute artifact path.
5. Verify `lab/credentials/` and `workbuddy/mcp/` no longer exist when the run ends.

## Hard boundaries

- 必须使用四个独立顶层 WorkBuddy 进程；不得使用 `--swarm`。
- 不得使用 `-y`、`bypassPermissions` 或其他权限绕过。
- Never place four bearer tokens in one parent environment, prompt, log, report, or mailbox.
- Lead is not a RunAgent. Do not call participant MCP tools, create a fifth participant, release barriers, or repair verdicts with operator authority.
- WorkBuddy mailbox is only for host lifecycle status, never case facts. Business collaboration must use WISER Message / Artifact.
- Treat Event/Receipt/evaluation as authoritative and OpenTelemetry as best effort. Missing telemetry is a coverage gap, not proof of Agent knowledge or failure.
- On failure, preserve sanitized diagnostics, destroy credentials, and stop at the stable error. Do not silently fall back to v1.
