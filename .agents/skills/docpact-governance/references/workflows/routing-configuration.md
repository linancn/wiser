# Routing Configuration

Maintain controlled route intents as a thin, deterministic alias layer over the existing rule graph.

This workflow configures `routing.intents`; it does not change the meaning of `route`, invent natural-language routing, or add new route input semantics. Every change must return to `route` and `validate-config --strict`.

## Workflow

### 1. Confirm the current routing shape

Start by identifying where the routing config actually lives.

If the config shape is unclear, run:

```bash
docpact doctor --root <repo> --format json
```

Then inspect the current rule graph and route behavior:

```bash
docpact list-rules --root <repo> --format json
```

Use this to determine whether the repository is:

- a plain `layout: repo` config
- a workspace root config with shared routing intents
- a child repo config that inherits a workspace profile

If a child repo inherits a workspace profile, routing updates must happen through:

- `overrides.routing.mode: merge`
- or `overrides.routing.mode: replace`

Do not add a new top-level routing block shape outside the published config model.

### 2. Inspect the current route use case

Start from one explicit task family or alias need, such as:

- a high-frequency module that users repeatedly route with `--paths`
- a recurring task category that should become a stable alias
- an existing alias that is too broad, too narrow, or collides with other intents

Inspect the current route behavior before proposing changes:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
```

If an existing intent already exists, also run:

```bash
docpact route --root <repo> --intent <alias> --format json --detail full
```

Use `list-rules` and `route` together to answer:

- which rules currently drive the recommendations
- whether the candidate alias maps to one coherent task family
- whether the alias should reuse current routing behavior or should be split

Read [../routing-configuration/controlled-intent-principles.md](../routing-configuration/controlled-intent-principles.md) before deciding the alias shape.

### 3. Choose the correct routing action

Pick one explicit action:

1. **No new intent needed**
   - Existing `--paths` or `--module` usage is already clear enough.
   - A new alias would add noise instead of clarity.
2. **Add a new intent**
   - A stable, repeated task family deserves a controlled alias.
3. **Adjust an existing intent**
   - The alias is valid, but its paths are too broad, too narrow, or outdated.
4. **Change inherited routing behavior**
   - The alias belongs in a workspace profile or a child repo override rather than local top-level routing.

Do not add aliases just because a path family exists. Add them only when:

- the task family is repeated enough to justify a name
- the alias stays deterministic
- the underlying paths still align with the current rule graph

Read [../routing-configuration/good-and-bad-intent-examples.md](../routing-configuration/good-and-bad-intent-examples.md) before finalizing the action.

### 4. Draft the smallest valid `routing.intents` change

Current routing config supports:

- `routing.intents.<alias>.paths[]`

Current guardrails:

- aliases must be non-empty
- each intent must declare at least one path
- paths must use the same repo-relative glob rules as triggers
- `route --intent` only accepts aliases declared in config
- duplicate aliases across effective configs are invalid

Current inheritance behavior:

- workspace profiles may define `routing.intents`
- child repos may use `overrides.routing.mode: merge|replace`
- in `merge`, child aliases replace inherited aliases with the same name and add new aliases
- in `replace`, inherited routing aliases are discarded and only child aliases remain

Start from [../../assets/routing-configuration/routing-intent-template.yaml](../../assets/routing-configuration/routing-intent-template.yaml). Use the smallest section that matches the current config model:

- repo-local routing block
- workspace profile routing block
- child `overrides.routing` block with `merge`
- child `overrides.routing` block with `replace`

Do not invent:

- free-text intent matching
- extra intent fields
- runtime weighting or semantic ranking knobs

### 5. Validate the intent with `route`

Every routing change must come back to both config validation and route behavior.

Always run:

```bash
docpact validate-config --root <repo> --strict
```

Then validate the route behavior:

```bash
docpact route --root <repo> --intent <alias> --format json --detail full
```

Also keep a before/after comparison for the target task family:

```bash
docpact route --root <repo> --paths <csv> --format json --detail full
docpact route --root <repo> --intent <alias> --format json --detail full
```

Use [../../assets/routing-configuration/validation-steps-template.md](../../assets/routing-configuration/validation-steps-template.md) to format the handoff, and compare against [../../assets/routing-configuration/route-before-after-example.md](../../assets/routing-configuration/route-before-after-example.md) when the output shape needs an example.

## Output Requirements

Always include:

- the chosen action: `no-new-intent`, `add-intent`, `adjust-intent`, or `workspace-routing-change`
- the exact config location to edit
- the proposed YAML snippet, or an explicit statement that no new intent is needed
- why the alias does not conflict with existing effective aliases
- how the alias relates to the current rule graph and route output
- the exact validation commands to run next

If the repository needs behavior beyond controlled aliases, stop and say so explicitly. Do not use this skill to smuggle free-text routing into the product.
