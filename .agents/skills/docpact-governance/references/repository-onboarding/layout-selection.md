# Repo vs Workspace Layout Selection

Use this reference when onboarding needs to recommend `layout: repo` or `layout: workspace`.

## Prefer `layout: repo` when

- the repository is governed as one unit
- there is one main `.docpact/config.yaml`
- rules do not need shared parent profiles and child overrides
- the team does not need per-child governance customization

## Consider `layout: workspace` when

- the repository contains multiple immediate child repos or governed units
- child units share common defaults
- child units still need local overrides
- a shared root governance profile would clearly reduce duplication

## Do not recommend workspace only because the repository is large

Repository size alone is not a reason to move to workspace inheritance.

Use workspace only when shared governance defaults plus child overrides are structurally needed.

## Output rule

Always give a single recommended layout and one short reason.

If workspace is recommended, note that child repos will need explicit `inherit.workspace_profile` and `overrides` rather than relying on implicit inheritance.
