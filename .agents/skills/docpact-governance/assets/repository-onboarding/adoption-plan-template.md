## Recommended First-Pass Adoption Plan

1. Establish or repair `.docpact/config.yaml`.
2. Validate the config with `docpact validate-config --strict`.
3. Inspect the effective rule graph with `docpact list-rules --format json`.
4. Inspect uncovered governance areas with `docpact coverage --format json`.
5. If current lint debt is expected, capture a lint report and create a baseline.
6. Begin incremental enforcement only after the previous steps are complete.

## Commands

```bash
docpact validate-config --root <repo> --strict
docpact list-rules --root <repo> --format json
docpact coverage --root <repo> --format json
docpact lint --root <repo> <diff-source-args> --format json --output .docpact/runs/onboarding.json
docpact baseline create --report .docpact/runs/onboarding.json --output .docpact/baseline.json
```

Use one explicit diff source in `<diff-source-args>`:

- `--staged`
- `--worktree`
- `--files <csv>`
- `--merge-base <ref>`
- `--base <sha> --head <sha>`
