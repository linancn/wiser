# Action Wrapper Boundaries

The official GitHub Action is intentionally thin.

## What It Does

- installs the published `docpact` CLI
- runs `docpact` with the provided `args`

## What It Does Not Do

- perform checkout for you
- choose `fetch-depth`
- invent wrapper-specific arguments for `baseline`, `waivers`, or `report output`
- upload artifacts
- decide repository policy

## Inputs

The wrapper exposes:

- `version`
- `args`

Keep integration examples aligned with that minimal surface.

## Consequence for This Skill

Do not propose workflow YAML like:

- `baseline: .docpact/baseline.json`
- `waivers: .docpact/waivers.yaml`
- `report-output: ...`

Instead, pass them through `with.args`.
