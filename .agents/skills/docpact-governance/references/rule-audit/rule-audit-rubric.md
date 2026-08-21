# Rule Audit Rubric

Use this rubric to turn structured CLI outputs into a rule-quality review.

## Required Inputs

- `docpact list-rules --format json`
- `docpact coverage --format json`
- `docpact doctor --format json`

## Audit Questions

### Coverage and Liveness

- Does `coverage` report any dead rules?
- Do uncovered hotspots sit next to an existing rule that is almost correct?
- Is there a mismatch between rule count and governed path quality?

### Rule Shape

- Are trigger families coherent and durable?
- Are required docs the smallest stable set that really carries the contract?
- Are multiple rules repeating nearly the same structure?

### Provenance and Inheritance

- Is the rule local, inherited, or override-derived?
- Is a child override justified, or is it carrying unnecessary divergence?
- Would a shared profile rule better represent the contract?

### Governance Clarity

- Would another maintainer understand why the rule exists?
- Is the `reason` still aligned with the actual trigger family?
- Does the rule help route and lint outputs stay explainable?

## Output Classes

Map findings into one of these:

- `dead-rule-candidate`
- `duplicate-or-overlap-candidate`
- `over-broad-trigger-candidate`
- `over-narrow-or-fragmented-candidate`
- `required-doc-binding-candidate`
- `inheritance-provenance-candidate`
- `healthy-no-change`
