# Review Evidence and Structure

`review mark` records review evidence. It does not certify that a stale document has been substantively updated.

## When `review mark` Is Appropriate

Use it only when:

- a real review has already happened
- the target is Markdown or YAML
- the next action is to record fresh review evidence

Path mode is the normal freshness-driven form:

```bash
docpact review mark --root <repo> --path <doc-path>
```

Diagnostics mode is valid only when the maintenance action comes from one explicit lint finding:

```bash
docpact review mark --root <repo> --report <report.json> --id <diagnostic_id>
```

## When It Is Not Appropriate

Do not use `review mark` for:

- a document that still needs substantive review or editing
- `uncovered-change`
- missing rules
- speculative “we probably looked at it” maintenance

## Structure Repair Guardrails

When repairing document structure:

- preserve governed document paths unless you also plan a coordinated rule/config change
- preserve existing review evidence when the format is still valid
- if you move or merge a governed doc, validate the rule graph afterwards

Useful follow-up commands:

```bash
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
docpact validate-config --root <repo> --strict
```
