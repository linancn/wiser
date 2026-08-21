# Review Mark Guidance

Use this note before recommending `docpact review mark`.

## Recommend `review mark` when

- the governed target is a Markdown or YAML document
- review really happened
- the finding is about missing or stale review evidence

## Do not recommend `review mark` when

- the finding is `uncovered-change`
- the required doc does not exist yet
- the document body still needs substantive updates
- the target path is not Markdown or YAML

## Preferred command

Prefer artifact-driven navigation:

```bash
docpact review mark --root <repo> --report <report.json> --id <diagnostic_id>
```

This keeps the repair tied to one explicit diagnostic instead of copying the path manually.
