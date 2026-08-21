# Workflow Boundary Guide

This guide applies to the governance-maintainer entrypoint. It does not replace the direct workflow entrypoint and it does not absorb detailed workflow procedures.

## Use `docpact` instead of `docpact-governance` when the task is:

- choosing what to read before coding
- running `lint` for a concrete diff
- drilling into one diagnostic
- recording completed review evidence
- checking whether governed docs are stale for immediate task trust

## Use `docpact-governance` when the task is:

- deciding how to onboard or restructure repository governance
- planning coverage backfill across uncovered areas
- drafting or refactoring rules
- maintaining controlled routing aliases
- auditing the rule graph as a system
- designing CI usage of the official wrapper
- performing stale-doc maintenance as repository governance work

## Return to `docpact` and use the failure-repair workflow only when:

- you already have a structured lint report
- the problem is narrowed to one `diagnostic_id`
- the next step is to repair, escalate, or classify that one finding

The failure-repair workflow is shared across direct workflow and maintainer workflow. It is not the default governance entrypoint.

## Workflow duplication rule

When you route to a workflow reference:

- name the workflow reference
- explain why it matches
- list the minimum inputs to gather

Do not restate the whole workflow reference unless the user explicitly asks for that detail.

## Product-gap rule

If none of the internal maintainer workflows fit, say so. Fall back to CLI inspection and call out the gap explicitly. Do not invent:

- new config semantics
- new skill-only workflow states
- new adoption-control behaviors
- new route or lint meanings
