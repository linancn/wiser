# Example Grouped Coverage Backfill

## Coverage Source

- command: `docpact coverage --root . --format json`
- governed path count: 420
- uncovered path count: 58

## Priority Groups

### Group: payments-domain

- priority: high
- backfill class: new-rule
- grouped paths:
  - `src/payments/**`
  - `docs/payments/**`
- why this group exists:
  - a stable product domain is completely uncovered
- nearby existing rules:
  - `api-surface`
- candidate docs to reuse or add:
  - reuse `README.md`
  - add `docs/payments.md`
- recommended next action:
  - hand off to `rule-authoring` for one repo-local rule draft
- handoff target:
  - `rule-authoring`

### Group: workflow-policies

- priority: medium
- backfill class: adjust-existing-rule
- grouped paths:
  - `.github/workflows/**`
- why this group exists:
  - governance likely belongs to an existing workspace root policy rule
- nearby existing rules:
  - `branch-policy`
- candidate docs to reuse or add:
  - reuse `AGENTS.md`
  - reuse `.docpact/config.yaml`
- recommended next action:
  - inspect whether `branch-policy` should widen or whether a sibling workspace rule should replace it
- handoff target:
  - `rule-authoring`

## Candidate Excludes

- grouped paths:
  - `dist/**`
  - `fixtures/**`
- reason:
  - generated and test fixture paths do not belong to governed product contracts
- proposed `coverage.exclude` pattern:
  - `dist/**`
  - `fixtures/**`
