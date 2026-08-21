# Workspace Audit Considerations

Use this guide when auditing a workspace rule graph with inherited profiles and child overrides.

## Shared Profile vs Child Override

Ask:

- is this governance contract shared across many child repos?
- if yes, should it live in `workspace.profiles.<name>.rules`?
- if no, should it stay child-local?

## Common Workspace Smells

- too many child `replace` overrides for the same inherited rule
- local divergence without a clear repo-specific contract
- shared profile rules that are so generic they no longer describe a real contract
- child repos using local additions where profile refinement would be clearer

## Routing Through Provenance

Use `list-rules` provenance fields:

- `rule_source`
- `config_source`
- `provenance_kind`
- `workspace_profile`

These help determine whether a smell is:

- a local rule problem
- a workspace default problem
- an override problem

## Audit Outcome

A workspace audit should end with one of:

- keep shared profile as-is
- revise shared profile rule
- replace one inherited rule in one child repo
- add one child-local rule
- reduce unnecessary child divergence
