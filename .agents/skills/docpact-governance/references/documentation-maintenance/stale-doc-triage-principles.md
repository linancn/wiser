# Stale-Doc Triage Principles

Use `docpact freshness` as the starting point for maintenance triage.

## Source of Truth

Prefer the JSON freshness report over text output.

Key fields:

- `path`
- `staleness_level`
- `commits_since_review`
- `days_since_review`
- `associated_changed_paths`
- `review_reference_problems`

## Primary Triage Split

### 1. Substantive review/update

Use when:

- `staleness_level` is `warn` or `critical`
- the document still appears to be the right governed target
- there is no evidence that the signal is only a metadata-format problem

Default interpretation:

- the document likely needs a real human or agent review
- the content may need revision
- review evidence should be refreshed only after the review is actually complete

### 2. Review-evidence refresh

Use when:

- the document has been genuinely reviewed
- the issue is missing or stale review evidence rather than unresolved content drift

Common signals:

- `missing-lastReviewedCommit`
- `missing-lastReviewedAt`
- `invalid-lastReviewedCommit`
- `invalid-lastReviewedAt`

### 3. Structure or metadata repair

Use when the review metadata cannot be safely interpreted.

Common signals:

- `unsupported-review-metadata-format`
- `invalid-yaml-review-metadata`
- `missing-document`

These require file-structure or metadata-shape repair before a normal review loop can resume.

### 4. Governance escalation

Use when the stale signal suggests the doc is no longer the right governed object, or the associated path mapping is suspicious.

Escalation is more appropriate than doc-body editing when:

- the document should probably not be in `requiredDocs`
- the associated changed paths no longer describe a coherent contract
- route recommendations are misleading because routing or rule bindings are weak

## Do Not Collapse These Classes

Do not treat every stale doc as “just run `review mark`”.

Do not treat every metadata problem as proof that the doc content is current.

Do not treat every stale signal as a rule problem either; most still start as document maintenance.
