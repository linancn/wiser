# Adoption Controls During Onboarding

Use this note when deciding whether onboarding should recommend baseline or waiver.

## Baseline

Recommend baseline when:

- the repository is adopting `docpact` for the first time
- current lint debt is real but too large to clear immediately
- the team wants to begin blocking new active findings without pretending old findings are fixed

Recommended sequence:

1. make config valid
2. run lint with an explicit diff source and capture a JSON report
3. create baseline from that report
4. use baseline during the initial enforcement period

Valid diff sources include:

- `--staged`
- `--worktree`
- `--files <csv>`
- `--merge-base <ref>`
- `--base <sha> --head <sha>`

## Waiver

Do not recommend waiver as the default onboarding mechanism.

Waiver is only appropriate when all of the following are true:

- the exception is narrow
- the exception is temporary
- the exception has explicit ownership
- the exception has an expiry date

If those conditions are not present, do not recommend waiver.

## Output rule

If onboarding recommends baseline, say why.

If onboarding does not recommend waiver, say that explicitly instead of staying silent.
