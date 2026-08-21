# Maintainer Routing Map

Use this map to choose the primary governance-maintainer workflow reference.

## Task-to-workflow mapping

| Maintainer task | Primary workflow reference | Typical evidence | Notes |
| --- | --- | --- | --- |
| First-time repository adoption | `repository-onboarding` | `doctor`, `validate-config --strict`, `coverage`, `list-rules` | Use when config is missing, thin, or layout choice is still open. |
| Add, replace, or disable rules | `rule-authoring` | `coverage`, `list-rules`, `validate-config --strict` | Use for concrete rule changes, not broad backlog planning. |
| Group uncovered hotspots into backfill work | `coverage-backfill` | `coverage` | Use before `rule-authoring` when the uncovered surface is still broad. |
| Add or repair controlled routing aliases | `routing-configuration` | `route`, `validate-config --strict` | Use only for `routing.intents` and routing override maintenance. |
| Audit rule-graph quality | `rule-audit` | `list-rules`, `coverage`, `doctor` | Use for dead rules, overlap, overly broad triggers, or provenance problems. |
| Design or repair CI integration | `ci-integration` | existing workflow files, action usage, CLI commands | Use for official wrapper adoption and workflow trigger decisions. |
| Remediate stale docs and invalid review references | `documentation-maintenance` | `freshness`, optionally `list-rules`, `coverage`, `route` | Use when `freshness` has already surfaced the problem. |

## Shared remediation handoff

Return to `docpact` and use the failure-repair workflow only when the maintainer task has already narrowed to:

- one explicit lint report
- one `diagnostic_id`
- one concrete finding that needs repair or escalation

Do not start with `failure-repair` for:

- onboarding
- coverage backlog work
- broad rule redesign
- stale-doc sweeps

## CLI fallback

If the task does not clearly fit an internal maintainer workflow, fall back to the smallest useful deterministic CLI surface:

- `doctor`
- `list-rules`
- `coverage`
- `freshness`
- `validate-config --strict`

State that no internal workflow cleanly fits yet instead of inventing a workaround workflow.
