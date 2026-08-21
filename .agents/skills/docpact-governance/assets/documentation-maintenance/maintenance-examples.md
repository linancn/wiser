# Documentation Maintenance Examples

## Example 1: Stale Doc Needs Real Review

Inputs:

- `path=docs/api.md`
- `staleness_level=critical`
- `review_reference_problems=[]`

Interpretation:

- this is not just a metadata issue
- the doc likely needs substantive review or update

First validation loop:

```bash
docpact freshness --root . --format json
```

## Example 2: Review Evidence Is Missing After Real Review

Inputs:

- `path=docs/guide.md`
- `staleness_level=ok`
- `review_reference_problems=missing-lastReviewedCommit,missing-lastReviewedAt`

Interpretation:

- freshness does not prove content drift
- the main problem is missing review evidence

Next step:

```bash
docpact review mark --root . --path docs/guide.md
docpact freshness --root . --format json
```

## Example 3: Stale Signal Suggests Governance Drift

Inputs:

- `path=docs/legacy-auth.md`
- `staleness_level=warn`
- associated changed paths no longer match the current auth surface

Interpretation:

- do not assume the doc body alone is the problem
- inspect whether rules or routing still bind the right document

Next step:

```bash
docpact list-rules --root . --format json
docpact coverage --root . --format json
docpact route --root . --paths src/auth/** --format json --detail full
```
