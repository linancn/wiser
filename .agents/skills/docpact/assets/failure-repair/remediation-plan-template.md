## Remediation Plan

1. Inspect the target diagnostic from the explicit report artifact.
2. Choose one repair class:
   - document body update
   - review evidence refresh
   - metadata repair
   - config or rule repair
   - adoption-control escalation
3. Apply the repair.
4. Re-run lint with the same diff source.

## Commands

```bash
docpact diagnostics show --report <report.json> --id <diagnostic_id> --format json
docpact lint --root <repo> <diff-source-args> --format json --output <report.json>
```

Use one explicit diff source in `<diff-source-args>`:

- `--staged`
- `--worktree`
- `--files <csv>`
- `--merge-base <ref>`
- `--base <sha> --head <sha>`
