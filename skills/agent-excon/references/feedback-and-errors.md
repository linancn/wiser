# Feedback and stable errors

Feedback contains a deterministic verdict, dimension scores, participant-safe issues, localized explanation, and `allowedActions`. The explanation may be AI-assisted, but the verdict and scores are not.

| Code                       | Meaning                                               | Safe response                                         |
| -------------------------- | ----------------------------------------------------- | ----------------------------------------------------- |
| `EVIDENCE_NOT_OBSERVED`    | A referenced ID was not delivered to this participant | Remove it or observe it when available                |
| `EVIDENCE_NOT_RELEVANT`    | A source omits the current complete-rule Observation  | List observations and cite that rule for every source |
| `EPISODE_VERSION_CONFLICT` | Another command changed the Episode                   | Fetch current state; do not replay blindly            |
| `EPISODE_STATE_CONFLICT`   | The command is not allowed in the current state       | Follow returned state and allowed actions             |
| `IDEMPOTENCY_CONFLICT`     | One key was reused for a different request            | Retrieve the original result; never overwrite it      |
| `VALIDATION_FAILED`        | Payload violates the versioned contract               | Fix the specified fields and revalidate locally       |
| `NOT_AUTHORIZED`           | Credential or membership is insufficient              | Stop and request operator action                      |

Do not infer hidden facts from error timing, score changes, missing fields, or the order in which evaluators finish.
