# Backfill Priority Standards

Use these standards to rank grouped uncovered areas.

## High Priority

Choose `high` when one or more of these are true:

- the area is user-facing, externally consumed, or critical to operators
- the hotspot covers a large, stable module family
- the area changes frequently and remains entirely uncovered
- a clear document target already exists, so the rule graph can improve quickly
- the uncovered area weakens important AI routing or lint confidence

## Medium Priority

Choose `medium` when:

- the area is real and durable, but less central
- the path family is moderately sized
- the doc target is plausible but may need one clarification step
- the work likely requires a local rule adjustment rather than an urgent new contract

## Low Priority

Choose `low` when:

- the area is narrow, infrequently changed, or operationally minor
- the likely backfill is valuable but not urgent
- the right governance document is still weakly defined

## Candidate Exclude Priority

If the right result is probably `coverage.exclude`, do not inflate it into a high-priority rule task.

Instead mark it as:

- `candidate-exclude`
- with a short reason such as generated output, vendor code, fixtures, or temporary paths

## Priority Notes

Priority should never be based on path count alone.

Always explain:

- why the group matters
- why now
- whether it reduces a meaningful uncovered hotspot
