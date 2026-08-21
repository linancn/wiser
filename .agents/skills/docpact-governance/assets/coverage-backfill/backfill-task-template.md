# Coverage Backfill Plan

## Coverage Source

- command:
- report path:
- governed path count:
- uncovered path count:

## Priority Groups

### Group: <name>

- priority:
- backfill class:
- grouped paths:
- why this group exists:
- nearby existing rules:
- candidate docs to reuse or add:
- recommended next action:
- handoff target:

Validation:

```bash
docpact list-rules --root <repo> --format json
docpact validate-config --root <repo> --strict
```

Optional:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

## Candidate Excludes

- grouped paths:
- reason:
- proposed `coverage.exclude` pattern:

## Needs More Context

- grouped paths:
- missing information:
- next discovery step:
