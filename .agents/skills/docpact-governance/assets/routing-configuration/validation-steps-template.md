# Routing Intent Validation Steps

## Proposed Action

- action:
- config file to edit:
- alias:
- why this alias is needed:

## Validation Commands

```bash
docpact validate-config --root <repo> --strict
docpact route --root <repo> --intent <alias> --format json --detail full
```

Comparison command:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

## Expected Checks

- strict config validation succeeds
- the alias resolves without `Unknown routing intent alias`
- route output stays deterministic
- recommended docs still align with the intended task family

## Handoff Summary

- alias added or adjusted:
- config location:
- before/after route difference:
- follow-up work, if any:
