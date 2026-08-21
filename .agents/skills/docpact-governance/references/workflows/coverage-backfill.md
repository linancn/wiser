# Coverage Backfill

Convert coverage audit results into a staged backfill plan without exploding the rule graph.

This workflow reference is for planning and grouping uncovered areas. It is not the place to force every uncovered path into a new rule. Prefer structured coverage and rule outputs, aggregate by durable governance domains, and hand individual rule drafting to the rule-authoring workflow reference.

## Workflow

### 1. Start from a structured coverage snapshot

Use a repository coverage audit as the source of truth.

Always start with:

```bash
docpact coverage --root <repo> --format json
docpact list-rules --root <repo> --format json
```

Treat these coverage fields as primary inputs:

- `rule_coverage.uncovered_paths`
- `rule_coverage.uncovered_hotspots`
- `rule_coverage.dead_rules`
- `doc_reachability.orphan_docs`

Use `list-rules` to understand the current graph around each uncovered area:

- nearby trigger families
- current required docs
- rule provenance and inheritance location

Do not backfill from text output when JSON is available.

### 2. Separate true backfill work from non-backfill noise

Not every uncovered area should become a rule.

Classify each uncovered cluster into one of these buckets:

- **backfill-new-rule**
  - a durable governance domain is missing from the rule graph
- **backfill-adjust-existing-rule**
  - an existing rule should be widened, narrowed, or moved
- **candidate-exclude**
  - the path is generated, temporary, vendor, fixture, or otherwise out of governance scope
- **needs-more-context**
  - the path family is real, but the right docs or governance contract are still unclear

Use `coverage.include/exclude` as the current governed path scope. If an uncovered hotspot clearly should never be governed, call that out as an explicit `coverage.exclude` candidate rather than pretending it needs a new rule.

Read:

- [../coverage-backfill/uncovered-grouping-principles.md](../coverage-backfill/uncovered-grouping-principles.md)
- [../coverage-backfill/backfill-priority-standards.md](../coverage-backfill/backfill-priority-standards.md)

### 3. Group uncovered paths by governance domain

Do not produce one task per file.

Group uncovered paths by the smallest durable domain that should share one governance contract, such as:

- one module family
- one service boundary
- one schema family
- one automation or policy surface

Good grouping signals:

- shared path prefix
- shared doc target
- shared operational owner
- shared API or workflow boundary

Bad grouping signals:

- one file per task
- arbitrary directory buckets with no shared governance contract
- mixing unrelated domains just to reduce task count

If grouping is uncertain, optionally use:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

Use `route` only to inspect likely document associations. It does not replace coverage as the source of truth for uncovered status.

### 4. Prioritize backfill work

Within grouped candidates, order work by governance value rather than raw file count.

Default priority questions:

- Does this hotspot affect user-facing APIs or critical workflows?
- Does it touch many governed paths repeatedly?
- Is there already a stable document that can be reused?
- Would a rule here reduce a large uncovered region without creating a broad catch-all?
- Is the area blocked by dead rules, orphan docs, or inherited config complexity?

Produce priority bands such as:

- `high`
- `medium`
- `low`

Priority must explain why the group should be addressed now, not only how many paths it contains.

### 5. Define the correct next step for each group

Every grouped backfill task should end in one of these next actions:

- draft a new rule
- revise an existing rule
- propose a coverage exclusion
- collect missing governance context first

When a group needs an actual rule draft, switch explicitly to the rule-authoring workflow reference.

Use:

```bash
docpact list-rules --root <repo> --format json
docpact validate-config --root <repo> --strict
```

and then route the specific group into the rule-authoring workflow reference.

Read [../coverage-backfill/rule-authoring-handoff.md](../coverage-backfill/rule-authoring-handoff.md) before drafting the handoff summary.

### 6. End with a staged backfill plan

Your final output should be a backlog-style plan, not a loose narrative.

Use [../../assets/coverage-backfill/backfill-task-template.md](../../assets/coverage-backfill/backfill-task-template.md) as the default output structure.

Include, for each group:

- grouped path family
- priority
- backfill class
- recommended next action
- candidate docs to reuse or add
- whether the next step is `rule-authoring`, `coverage.exclude`, or more discovery
- validation commands

If helpful, compare against [../../assets/coverage-backfill/grouped-backfill-example.md](../../assets/coverage-backfill/grouped-backfill-example.md) for the expected level of aggregation.

## Output Requirements

Always include:

- the source coverage report or command used
- grouped uncovered areas, not just raw uncovered paths
- a priority for each group
- whether each group is:
  - `new-rule`
  - `adjust-existing-rule`
  - `candidate-exclude`
  - `needs-more-context`
- which groups should switch to the rule-authoring workflow reference
- the exact validation commands for the next step

Do not generate final rule YAML for every group inside this workflow. When the work becomes one concrete rule change, switch to the rule-authoring workflow reference.
