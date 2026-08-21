# CLI Handoff Guide

Use this guide to keep the direct workflow skill aligned with the existing CLI.

## Route

Use:

```bash
docpact route --root <repo> --paths <csv> --format json
```

Or:

```bash
docpact route --root <repo> --module <prefix> --format json
docpact render --root <repo> --view routing-summary --format json
docpact route --root <repo> --intent <alias> --format json
```

Notes:

- `route` is advisory only
- `--intent` only accepts effective aliases listed by `render --view routing-summary`
- `--detail full` is optional
- route warnings such as `no-tracked-path-matches`, `no-rule-matches`, and `no-route-recommendations` mean the input or routing setup needs inspection before assuming there is nothing to read

## Lint

Use:

```bash
docpact lint --root <repo> <diff-source-args> --format json --output .docpact/runs/latest.json
```

Contract:

- stdout is a paged `docpact.lint-report.v1` report
- `--output` is the full diagnostics artifact used for drill-down
- stderr may contain saved-report hints; stdout remains pure JSON with `--format json`

Required diff source:

- `--files <csv>`
- `--staged`
- `--worktree`
- `--merge-base <ref>`
- `--base <sha> --head <sha>`

## Diagnostics Show

Use:

```bash
docpact diagnostics show --report .docpact/runs/latest.json --id <diagnostic_id> --format json
```

Use only when one saved lint report already exists.

## Explain

Use:

```bash
docpact explain <path> --root <repo> --format json
```

Use when rule matching is unclear and there is no specific saved diagnostic to inspect.

## Validate Config

Use:

```bash
docpact validate-config --root <repo> --strict --format json
```

Use when config loading, inheritance, routing aliases, ownership, or structural rule errors need machine-readable debugging.

## Review Mark

Use:

```bash
docpact review mark --root <repo> --report .docpact/runs/latest.json --id <diagnostic_id>
```

Or:

```bash
docpact review mark --root <repo> --path <doc-path>
```

Notes:

- only after a review is genuinely complete
- path mode and report/id mode cannot be mixed

## Freshness

Use:

```bash
docpact freshness --root <repo> --format json
```

Use when the question is about whether governed documents still look trustworthy, not whether one specific diff passed lint.
