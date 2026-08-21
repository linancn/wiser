# Uncovered Grouping Principles

Group uncovered areas by governance contract, not by raw file count.

## Good Grouping Signals

- Shared repo-relative path prefix
- Shared service or module boundary
- Shared document target or likely doc family
- Shared owner or operational surface
- Shared reason a future rule would exist

## Bad Grouping Signals

- One task per uncovered file
- A single giant "miscellaneous uncovered paths" bucket
- Grouping only by directory name when governance intent is unrelated
- Mixing generated paths, real product code, and docs in the same task

## Preferred Group Shapes

Prefer groups that could plausibly map to:

- one future rule
- one existing rule revision
- one explicit `coverage.exclude` decision

If a group would obviously need multiple unrelated rules, split it earlier.

## Relationship to Existing Rules

Before declaring a new backfill group:

- inspect nearby existing triggers
- inspect nearby required docs
- check whether a current rule is almost correct and should be revised instead

Use `list-rules` to confirm whether the uncovered area is actually:

- a missing governance contract
- a misplaced trigger
- an inherited rule that needs local replacement

## Workspace Considerations

In workspace layouts, ask:

- does this uncovered area belong in a shared profile?
- is it only relevant to one child repo?
- would the eventual fix be `overrides.rules.add` or `overrides.rules.replace`?

Do not group child-repo-specific work into a shared workspace task unless the governance contract is genuinely shared.
