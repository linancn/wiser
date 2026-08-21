# Workflow Trigger Selection

Use the workflow trigger that matches the semantic scope of the command.

## `pull_request`

Best for:

- `docpact lint`
- `docpact lint` with `--baseline`
- `docpact lint` with `--waivers`

Why:

- `lint` is diff-driven
- PRs provide a natural `base` / `head` comparison
- annotations are most useful during review

## `push`

Best for:

- repository coverage audit on the default branch

Why:

- coverage is repo-level
- it does not depend on one PR diff
- running after merges helps audit the current mainline state

## `schedule`

Best for:

- `docpact freshness`

Why:

- freshness is an ongoing trust signal
- it benefits from periodic checking rather than per-PR invocation

## `workflow_dispatch`

Useful when:

- teams want a manual rerun path for coverage or freshness
- a governance maintainer needs an ad hoc audit run

## Anti-Patterns

- using `schedule` for PR lint
- using `pull_request` as the primary trigger for repo-level coverage audits
- running every audit on every trigger without a clear audience
