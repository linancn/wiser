# Rule Authoring Handoff

When a grouped backfill task is ready for a concrete rule change, hand it off cleanly to `rule-authoring`.

## Minimum Handoff Fields

Include:

- grouped path family
- backfill class: `new-rule` or `adjust-existing-rule`
- candidate documents to reuse or add
- nearby existing rule ids
- current config location to edit
- whether the target is:
  - repo-local
  - workspace-profile
  - child override add
  - child override replace

## What Not to Do

- Do not embed a final rule draft inside every backfill task by default.
- Do not skip straight from uncovered hotspot to YAML if the governance contract is still unclear.
- Do not hand off raw file lists without grouping context.

## Validation Chain

The handoff should point back to:

```bash
docpact list-rules --root <repo> --format json
docpact validate-config --root <repo> --strict
```

If document reuse is unclear, optionally add:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

## Expected Outcome

A good handoff gives `rule-authoring` one focused governance task instead of a whole audit dump.
