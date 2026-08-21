# Workspace Routing Overrides

Use this guide when routing aliases live in a workspace profile and a child repo needs different behavior.

## Shared Defaults

Shared routing aliases belong in:

- `workspace.profiles.<name>.routing.intents`

Use this when multiple child repos should share the same alias semantics.

## Child Merge

Use:

```yaml
overrides:
  routing:
    mode: merge
    intents:
      ...
```

when the child repo should:

- keep inherited aliases
- replace one inherited alias with the same name
- add a few child-local aliases

## Child Replace

Use:

```yaml
overrides:
  routing:
    mode: replace
    intents:
      ...
```

when the child repo should discard the inherited routing block entirely.

Choose `replace` only when the shared aliases are not appropriate for the child repo at all.

## Common Mistakes

- redefining child-local routing outside `overrides.routing`
- using `replace` when one additional alias would have been enough
- adding overlapping aliases without explaining whether they are shared or local
