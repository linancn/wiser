# Rule Authoring Handoff

When a rule audit produces one concrete refactor task, hand it off to `rule-authoring`.

## Good Handoff Inputs

- target rule ids
- audit class
- affected trigger families
- affected required docs
- config provenance
- whether the action is merge, split, trigger adjustment, required-doc adjustment, or inheritance cleanup

## Avoid

- handoff with only vague prose
- handoff without concrete rule ids or path families
- handoff that skips validation expectations

## Required Validation Chain

```bash
docpact list-rules --root <repo> --format json
docpact validate-config --root <repo> --strict
docpact coverage --root <repo> --format json
```
