# Direct Workflow Examples

## Before Coding

Question:

- "I am about to touch `src/payments/charge.ts`. What should I read first?"

Answer shape:

- phase: `before-coding`
- first command:

```bash
docpact route --root . --paths src/payments/charge.ts --format json
```

## After Coding

Question:

- "I changed `src/api/client.ts`. What docs should have been reviewed?"

Answer shape:

- phase: `after-coding`
- first command:

```bash
docpact lint --root . --files src/api/client.ts --format json --output .docpact/runs/latest.json
```

If lint needs drill-down:

```bash
docpact diagnostics show --report .docpact/runs/latest.json --id d001 --format json
```

## Ongoing

Question:

- "Are the governed docs in this repo getting stale?"

Answer shape:

- phase: `ongoing`
- first command:

```bash
docpact freshness --root . --format json
```
