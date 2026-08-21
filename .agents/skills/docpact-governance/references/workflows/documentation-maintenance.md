# Documentation Maintenance

Turn repository-level freshness signals into the smallest correct maintenance action.

This workflow reference is for the `ongoing` phase after `docpact freshness` has exposed one or more governed docs as stale, suspicious, or missing valid review references. It is not a generic rewrite workflow, and it is not a shortcut around rule/config maintenance.

## Workflow

### 1. Start from a structured freshness snapshot

Use `freshness` as the source of truth.

Default command:

```bash
docpact freshness --root <repo> --format json
```

Treat these fields as the primary inputs:

- `summary.stale_doc_count`
- `summary.invalid_review_reference_count`
- `items[].path`
- `items[].staleness_level`
- `items[].commits_since_review`
- `items[].days_since_review`
- `items[].associated_changed_paths`
- `items[].review_reference_problems`

Do not start with prose-only interpretation when the JSON report is available.

Read [../documentation-maintenance/stale-doc-triage-principles.md](../documentation-maintenance/stale-doc-triage-principles.md) before classifying actions.

### 2. Classify each stale doc into the correct maintenance path

Each governed doc should land in one of these maintenance classes:

- `substantive-review-update`
  - the document appears genuinely stale and likely needs a real content review or update
- `review-evidence-refresh`
  - the real problem is stale or invalid review evidence after a genuine review
- `structure-or-metadata-repair`
  - the doc path, frontmatter shape, or review metadata format is broken and must be repaired before normal review tracking can resume
- `governance-model-escalation`
  - the stale signal points to a rule, routing, or governance-boundary problem rather than a document-body problem

Useful default signals:

- `staleness_level=warn|critical` with no review-reference problems
  - start with `substantive-review-update`
- `review_reference_problems` contains:
  - `missing-lastReviewedCommit`
  - `missing-lastReviewedAt`
  - `invalid-lastReviewedCommit`
  - `invalid-lastReviewedAt`
    - start with `review-evidence-refresh` or `structure-or-metadata-repair`
- `review_reference_problems` contains:
  - `unsupported-review-metadata-format`
  - `invalid-yaml-review-metadata`
  - `missing-document`
    - start with `structure-or-metadata-repair`

If the document no longer looks like the right governed target for the associated paths, stop treating it as only a doc-maintenance problem and escalate.

### 3. Distinguish content review from review-evidence repair

Do not use `review mark` as a freshness autofix.

Use `review mark` only when:

- a real review has been completed
- the target path is Markdown or YAML
- the maintenance action is about recording fresh review evidence, not hiding a still-stale document

For freshness-driven maintenance, path mode is the normal default:

```bash
docpact review mark --root <repo> --path <doc-path>
```

If the stale doc is also implicated by one explicit lint diagnostic, diagnostics mode is valid:

```bash
docpact review mark --root <repo> --report <report.json> --id <diagnostic_id>
```

Read [../documentation-maintenance/review-evidence-and-structure.md](../documentation-maintenance/review-evidence-and-structure.md) before recommending `review mark`.

### 4. Escalate when the stale signal is really a governance problem

Use these supporting commands when the stale result may reflect rule or routing drift:

```bash
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
```

Optionally inspect the related reading path:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

Escalate to the correct maintainer workflow reference when appropriate:

- `rule-authoring`
  - the governed doc should change because the rule graph is wrong or incomplete
- `routing-configuration`
  - stale trust comes from weak or misleading routing aliases
- `rule-audit`
  - the broader rule graph looks redundant, dead, or poorly bound

Read [../documentation-maintenance/maintenance-escalation-guide.md](../documentation-maintenance/maintenance-escalation-guide.md) before choosing escalation.

### 5. End with a maintenance plan and explicit validation

Every maintenance recommendation must end with executable validation.

Typical validation loops:

After substantive doc review/update:

```bash
docpact freshness --root <repo> --format json
```

After review evidence refresh:

```bash
docpact review mark --root <repo> --path <doc-path>
docpact freshness --root <repo> --format json
```

After structure or metadata repair:

```bash
docpact freshness --root <repo> --format json
```

After governance escalation:

```bash
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
docpact validate-config --root <repo> --strict
```

If the stale maintenance overlaps with an active code diff, add the relevant `lint` rerun with explicit diff-source args.

Use:

- [../../assets/documentation-maintenance/maintenance-checklist.md](../../assets/documentation-maintenance/maintenance-checklist.md)
- [../../assets/documentation-maintenance/stale-remediation-template.md](../../assets/documentation-maintenance/stale-remediation-template.md)
- [../../assets/documentation-maintenance/maintenance-examples.md](../../assets/documentation-maintenance/maintenance-examples.md)

## Output Requirements

Always include:

- the source freshness command or report
- the maintenance class for each targeted doc
- whether the next step is:
  - substantive review/update
  - review evidence refresh
  - structure/metadata repair
  - governance escalation
- why `review mark` is or is not appropriate
- the exact validation commands to run next

Do not recommend blanket cleanup or rule relaxation just because many docs are stale. Keep the maintenance action scoped to the evidence.
