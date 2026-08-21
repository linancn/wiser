# Adoption Controls During Failure Repair

Use this note when a finding should not be handled as a normal inline repair.

## Baseline

Recommend baseline only when the finding is part of historical repository debt and the team is still in staged adoption.

Signals:

- the same category appears across many existing files
- the team is trying to start enforcement gradually
- the finding is not a narrow temporary exception

For single-finding repair, baseline is usually not the immediate action. Instead, explain that the issue belongs to a broader adoption-control decision.

## Waiver

Waiver is not a normal repair action.

Recommend waiver only when all of the following are true:

- the exception is narrow
- the exception is temporary
- there is explicit owner and reason
- there is a concrete expiry date

If those conditions are missing, do not recommend waiver.

## Output rule

When baseline or waiver is mentioned, explicitly say why normal repair is not the preferred path.
