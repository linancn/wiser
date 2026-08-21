# Bad Rule Antipatterns

These are common ways to make the rule graph noisier, less explainable, or semantically wrong.

## 1. Adding a new rule when an existing rule already fits

Bad:

- A new rule repeats an existing trigger family and points to the same required docs, only because the existing rule was not inspected first.

Why it is bad:

- It creates redundant matches and makes `list-rules`, `lint`, and `route` harder to explain.

Preferred fix:

- Reuse the existing rule, or replace it if the contract truly changed.

## 2. Using over-broad catch-all triggers

Bad:

```yaml
triggers:
  - path: src/**
    kind: code
```

when the real need only applies to `src/payments/**`.

Why it is bad:

- It silently widens governance obligations and produces noisy lint and routing results.

Preferred fix:

- Match the smallest durable path family that actually shares a contract.

## 3. Treating `requiredDocs` as a coverage filter

Bad:

- Adding more required docs because the team wants coverage to "feel stronger."

Why it is bad:

- Coverage is driven by trigger matches, not by the size of `requiredDocs`.
- Extra required docs increase maintenance burden without improving signal quality.

Preferred fix:

- Keep `requiredDocs` limited to documents that must actually carry the governance contract.

## 4. Inventing semantics for descriptive fields

Bad:

- Assuming `scope`, `repo`, or trigger `kind` change runtime matching behavior.

Why it is bad:

- The current engine preserves these fields, but does not use them to change matching logic.

Preferred fix:

- Use those fields descriptively only, and put real matching intent in `path` patterns and `requiredDocs`.

## 5. Using unsupported modes or wishful semantics

Bad:

- Writing a custom mode such as `docs_refresh_required`
- Treating `must_exist` as if it meant "review not required"

Why it is bad:

- The draft will not reflect real engine behavior and may fail strict validation.

Preferred fix:

- Choose from the supported mode set only, and justify the choice explicitly.

## 6. Writing top-level rules in an inherited child config

Bad:

- A child repo with `inherit.workspace_profile` adds top-level `rules`.

Why it is bad:

- Current inheritance rules make that config shape invalid.

Preferred fix:

- Use `overrides.rules.add` or `overrides.rules.replace`.

## 7. Replacing an inherited rule when `add` is enough

Bad:

- Rewriting a shared workspace rule only to add one unrelated local domain rule.

Why it is bad:

- It increases divergence between the child repo and the shared profile for no benefit.

Preferred fix:

- Use `overrides.rules.add` for local additions.

## 8. Adding a duplicate local rule instead of replacing the inherited one

Bad:

- Keeping the inherited rule and adding a second local rule with nearly identical triggers and docs.

Why it is bad:

- Both rules can match, leading to duplicated or confusing obligations.

Preferred fix:

- Use `overrides.rules.replace` when the child repo needs to change the inherited contract itself.
