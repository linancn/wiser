# Onboarding Checklist

Use this checklist when producing a first-pass repository onboarding summary.

## Required summary sections

1. Current state
2. Recommended layout
3. Immediate config work
4. Rule and coverage follow-up
5. Adoption-control recommendation
6. Validation commands

## Current state

Summarize:

- whether `.docpact/config.yaml` exists
- whether `validate-config --strict` passes
- current rule count
- whether coverage is configured
- whether document inventory is configured
- whether freshness is configured

## Recommended layout

Choose one:

- `layout: repo`
- `layout: workspace`

Explain why the repository does or does not need shared workspace profiles.

## Immediate config work

Call out:

- missing config
- invalid config
- empty rule graph
- missing coverage scope
- missing governed docs

## Rule and coverage follow-up

Use `coverage --format json` and `list-rules --format json` to separate:

- missing initial rules
- weak or incomplete existing rules
- uncovered hotspots that should become backfill work

## Adoption-control recommendation

Default recommendation order:

1. repair or draft config
2. validate config
3. observe lint debt
4. create baseline if needed
5. start incremental enforcement

Waiver should only appear if the user has a narrow, temporary, explicitly owned exception.

## Validation commands

End with executable commands, not generic advice.

Minimum command set:

```bash
docpact validate-config --root <repo> --strict
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
```
