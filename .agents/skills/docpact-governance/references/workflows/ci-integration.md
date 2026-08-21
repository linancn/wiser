# CI Integration

Build `docpact` CI workflows around the already-published wrapper and the already-published CLI. This workflow should help a maintainer decide which workflow shape fits the repository, produce or review workflow YAML, and keep adoption controls explicit.

Do not create a second CI-facing syntax for `baseline`, `waivers`, `coverage`, `freshness`, or report artifacts. Keep the workflow thin and let the CLI remain the source of truth.

## Workflow

### 1. Inspect the repository's current governance and CI shape

Before drafting workflow YAML, confirm the repository's governance maturity and current CI setup.

Start with:

```bash
docpact doctor --root <repo> --format json
```

Use the result to classify the repository into one of these starting states:

- no meaningful governance surface yet
- local-only governance, not ready for blocking CI
- mature enough for PR lint gating
- mature enough for repo-level audits on `push` / `schedule`

Then inspect existing workflow files in `.github/workflows/` if they exist. Do not assume `docpact` owns the whole CI pipeline.

### 2. Choose the correct workflow family

Do not use one workflow shape for every job.

Default mapping:

- PR lint gate
  - `pull_request`
  - use `docpact lint`
- PR lint with adoption controls
  - `pull_request`
  - use `docpact lint` with `--baseline` and/or `--waivers`
- repository coverage audit
  - default branch `push`
  - optional `workflow_dispatch`
  - use `docpact coverage`
- freshness audit
  - `schedule`
  - optional `workflow_dispatch`
  - use `docpact freshness`

Read:

- [../ci-integration/workflow-trigger-selection.md](../ci-integration/workflow-trigger-selection.md)
- [../ci-integration/action-wrapper-boundaries.md](../ci-integration/action-wrapper-boundaries.md)

### 3. Keep the wrapper thin and CLI-first

The official action only exposes:

- `version`
- `args`

It installs the published CLI and runs it. It does not replace:

- `actions/checkout`
- checkout depth strategy
- artifact upload
- a second parameter model for baseline, waivers, or report output

Therefore the recommended workflow pattern is:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0

- uses: your-org/docpact@v1
  with:
    version: 0.1.0
    args: >
      lint
      --root .
      --base ${{ github.event.pull_request.base.sha }}
      --head ${{ github.sha }}
      --mode enforce
```

Do not rewrite CLI flags as new action inputs.

### 4. Treat adoption controls as explicit, risky choices

If baseline or waivers are already part of the repository's governance approach, pass them through the same CLI flags used locally.

Examples:

```yaml
args: >
  lint
  --root .
  --base ${{ github.event.pull_request.base.sha }}
  --head ${{ github.sha }}
  --mode enforce
  --baseline .docpact/baseline.json
  --waivers .docpact/waivers.yaml
```

Read [../ci-integration/adoption-controls-in-ci.md](../ci-integration/adoption-controls-in-ci.md) before recommending either one.

Default guidance:

- baseline is acceptable for staged rollout of historical debt
- waiver is an explicit temporary exception path and should stay rare
- neither should be hidden behind workflow-specific abstraction

### 5. Keep reports and artifacts optional

Do not force every CI integration to upload reports or artifacts.

Use `--output` only when a machine-consumable report path is actually needed.

Typical cases:

- PR gate with human-readable output only
  - no report upload required
- PR gate with follow-up machine step
  - add `--output`
- audit workflow that needs durable JSON artifact
  - add `--format json` and `--output`

The workflow file remains responsible for artifact upload if desired. The action does not own that behavior.

### 6. End with concrete workflow snippets and review checks

Shape the final recommendation using:

- [../../assets/ci-integration/workflow-snippet-library.md](../../assets/ci-integration/workflow-snippet-library.md)
- [../../assets/ci-integration/ci-integration-checklist.md](../../assets/ci-integration/ci-integration-checklist.md)
- [../../assets/ci-integration/integration-review-template.md](../../assets/ci-integration/integration-review-template.md)

## Output Requirements

Always include:

- the chosen workflow family or families
- why each job runs on `pull_request`, `push`, `schedule`, or `workflow_dispatch`
- the first `docpact` command each job should run
- whether `baseline` or `waivers` are appropriate
- whether `--output` and artifact upload are necessary or optional
- the exact workflow snippet or review correction

If the repository is not ready for blocking CI yet, say so explicitly and prefer a staged adoption plan over pretending `enforce` is already appropriate.
