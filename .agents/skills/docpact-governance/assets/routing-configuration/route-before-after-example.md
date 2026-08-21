# Route Before/After Example

## Before

Command:

```bash
docpact route --root . --paths src/payments/charge.ts --format json --detail full
```

Use when:

- the task family is not yet captured by a controlled alias

## After

Command:

```bash
docpact route --root . --intent payments --format json --detail full
```

Use when:

- the repository has added a stable `payments` alias under `routing.intents`

## What Should Stay the Same

- the route result stays deterministic
- the recommendation list still reflects the current rule graph
- the alias is only a controlled shortcut, not a different routing engine
