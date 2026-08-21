# Adoption Controls in CI

Baseline and waiver should stay explicit in CI.

## Baseline

Use when:

- the repository is onboarding with historical debt
- the team wants PRs to fail only on new active findings

Typical CI usage:

```yaml
args: >
  lint
  --root .
  --base ${{ github.event.pull_request.base.sha }}
  --head ${{ github.sha }}
  --mode enforce
  --baseline .docpact/baseline.json
```

## Waivers

Use only when:

- a temporary exception is already justified
- the waiver file is reviewed and versioned explicitly

Typical CI usage:

```yaml
args: >
  lint
  --root .
  --base ${{ github.event.pull_request.base.sha }}
  --head ${{ github.sha }}
  --mode enforce
  --waivers .docpact/waivers.yaml
```

## Guardrails

- do not hide baseline or waiver inside wrapper-specific inputs
- do not recommend waiver as the default onboarding path
- if the repository still needs broad staged rollout, prefer baseline-first adoption
