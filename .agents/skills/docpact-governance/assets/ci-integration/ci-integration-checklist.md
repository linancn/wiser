# CI Integration Checklist

- Existing `.github/workflows/` shape reviewed
- `docpact doctor --root <repo> --format json` considered
- Correct workflow family chosen:
  - PR lint
  - PR lint with adoption controls
  - coverage audit
  - freshness audit
- `actions/checkout` present
- `fetch-depth: 0` considered for diff reliability
- Official wrapper used without inventing new inputs
- CLI flags passed through `with.args`
- `baseline` / `waivers` only included when justified
- `--output` and artifact upload treated as optional
- Trigger timing justified explicitly
