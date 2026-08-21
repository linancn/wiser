# Maintainer Routing Examples

## Example 1: Missing first-pass config

Input:

- repository has no `.docpact/config.yaml`
- maintainer wants to introduce docpact gradually

Route:

- primary workflow reference: `repository-onboarding`
- evidence: `doctor`, then starter config drafting, then `validate-config --strict`

Why:

- the task is repository adoption, not a single rule or finding repair

## Example 2: Coverage report shows broad uncovered hotspots

Input:

- `coverage` reports multiple uncovered hotspot groups
- maintainer wants a phased backlog rather than one ad hoc rule

Route:

- primary workflow reference: `coverage-backfill`
- evidence: `coverage --format json`

Why:

- the task is grouping and prioritizing governance debt before concrete rule drafting

## Example 3: Rule graph looks redundant

Input:

- `list-rules` and `coverage` suggest overlapping or dead rules

Route:

- primary workflow reference: `rule-audit`
- evidence: `list-rules`, `coverage`, optionally `doctor`

Why:

- the problem is system-level rule quality, not one concrete rule edit yet

## Example 4: Stale docs and invalid review references

Input:

- `freshness` reports `critical` stale docs and invalid review references

Route:

- primary workflow reference: `documentation-maintenance`
- evidence: `freshness`, optionally `list-rules` or `route`

Why:

- the task is stale-doc remediation and review-evidence maintenance

## Example 5: Broad governance question collapses to one finding

Input:

- maintainer originally investigates a broader issue
- the actual next step is repairing `d004` from one lint report

Route:

- return to `docpact` and use workflow reference: `failure-repair`
- evidence: lint report JSON plus `diagnostic_id`

Why:

- once the task is one explicit finding, shared remediation is the narrowest correct workflow
