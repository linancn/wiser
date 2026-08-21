# Finding Repair Matrix

Use this matrix to map one finding to one repair path.

## Step 1: Check `finding_state`

- `active`
  - normal repair path
- `suppressed_by_baseline`
  - not a normal fresh regression
  - explain that baseline is currently suppressing the finding
  - only recommend immediate repair if the user wants to pay down historical debt now
- `waived`
  - not a normal repair path
  - explain the waiver reason, owner, and expiry
  - only recommend repair if the user wants to remove the waiver

## Step 2: Map `problem_type`

### `missing-review`

Use `failure_reason` to decide the fix.

- `required_doc_missing`
  - create the required doc
- `required_doc_missing_after_change`
  - restore or recreate the required doc
- `required_doc_not_touched`
  - inspect `required_mode`
  - if a substantive document update is expected, edit the doc
  - if only review evidence is needed after a real review, use `review mark`
- `review_metadata_not_refreshed`
  - complete review, then use `review mark`
- `doc_body_not_updated`
  - update document body content, not just metadata

### `missing-metadata`

- add or refresh review metadata keys
- if the file is Markdown or YAML and review is complete, `review mark` is usually the cleanest path

### `uncovered-change`

- repair the rule graph, not the document
- add a matching rule or exclude the path from coverage

## Step 3: Escalate when needed

If the finding is historical adoption debt rather than a fresh repair task:

- recommend baseline, not waiver

If the finding truly requires a narrow, temporary exception:

- waiver can be considered, but only with explicit reason, owner, and expiry
