# Rule Design Checklist

Use this checklist before proposing a new or revised `docpact` rule.

## Problem Definition

- Is there one explicit governance problem to solve?
- Is the target path or module concrete enough to inspect with `coverage`?
- Have you separated "missing rule" from "missing doc maintenance"?

## Rule Graph Inspection

- Did you run `docpact coverage --format json`?
- Did you run `docpact list-rules --format json`?
- Did you verify whether an existing rule already covers the target?
- Did you inspect whether an existing required doc can be reused?

## Authoring Decision

- Is the correct action clearly one of:
  - no new rule needed
  - modify existing rule
  - add new rule
  - workspace profile or override change
- If a child repo inherits a workspace profile, did you avoid top-level `rules` and use `overrides.rules.*` instead?
- If an inherited rule needs different semantics, did you choose `replace` instead of adding a duplicate shadow rule?

## Rule Shape

- Does the draft use only published fields?
- Does every rule include:
  - `id`
  - `scope`
  - `repo`
  - `triggers`
  - `requiredDocs`
  - `reason`
- Are all trigger paths repo-relative globs?
- Are `requiredDocs[].mode` values limited to supported modes?

## Governance Quality

- Are triggers narrow enough to represent one governance contract?
- Are required docs the smallest stable set of documents that should carry that contract?
- Did you avoid adding config docs or root docs unless they are genuinely part of the governance contract?
- Is `reason` specific enough that another maintainer can understand why the rule exists?

## Validation

- Will the draft be checked with `docpact validate-config --strict`?
- Will `list-rules` be rerun to confirm the effective graph looks correct?
- Will `coverage` be rerun to confirm the uncovered area is actually addressed?
- If task guidance is part of the goal, will `route` be rerun to confirm the recommendation looks sensible?
