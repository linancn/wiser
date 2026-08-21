# Rule Authoring Validation Steps

## Proposed Action

- authoring action:
- config file to edit:
- rule id:
- why this is not better handled by an existing rule:

## Validation Commands

```bash
docpact validate-config --root <repo> --strict
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
```

Optional follow-up when task routing quality matters:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

## Expected Checks

- `validate-config --strict` succeeds
- `list-rules` shows the intended rule source and effective config provenance
- `coverage` no longer reports the target path as uncovered
- `route` recommends the intended docs if the rule should affect task guidance

## Handoff Summary

- existing rule reused:
- existing rule replaced:
- new required docs introduced:
- validation result:
- follow-up work, if any:
